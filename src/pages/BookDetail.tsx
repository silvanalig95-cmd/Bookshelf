import { useEffect, useMemo, useState } from 'react';
import { Link, useNavigate, useParams, useSearchParams } from 'react-router-dom';
import { BookRow } from '../components/BookCard';
import { Cover } from '../components/Cover';
import { EditionPicker } from '../components/EditionPicker';
import { Empty, Loading } from '../components/Feedback';
import { OffersPanel } from '../components/OffersPanel';
import { Stars } from '../components/Stars';
import { distinctiveSubjects, hasGerman } from '../lib/discovery';
import { formatLabel, pickDefaultEdition } from '../lib/editions';
import { googleBookByIsbn, googleVolume, type GBResult } from '../lib/googleBooks';
import { errorMessage, useAsync, useLibraryEntries, useProfile, useReadIndex } from '../lib/hooks';
import { settle } from '../lib/http';
import { docToBook, getBookByWorkId, getEditions, getWork, isbnCoverUrl, searchWorks, workForIsbn, type WorkDetails } from '../lib/openLibrary';
import { scoreForProfile } from '../lib/recommend';
import { displaySubjects, languageLabel, subjectLabel } from '../lib/taxonomy';
import { annasArchiveLink } from '../lib/shops';
import { solrPhrase, uniq } from '../lib/text';
import type { Book, Edition } from '../lib/types';
import { useSettings } from '../store/settings';
import { richGermanText, wikiMaterial } from '../lib/bookTexts';
import { contentSummary, deeplUrl, germanWikipediaSummary, guessLanguage } from '../lib/wikipedia';
import type { AiConfig } from '../lib/aiPrompts';
import { aiAvailability, aiConfigFor, type AiAccess } from '../lib/aiStatus';
import { useImpressions } from '../store/impressions';
import { autoBlurb, generateBlurb, lookupBlurb, useBlurbs } from '../store/blurbs';
import { publisherText } from '../store/bookInfo';
import { reportBook } from '../store/knowledge';
import { useNightShift } from '../store/nightShift';
import { FORMAT_LABEL, ownedLabel, useOwned, type OwnedFormat } from '../store/owned';
import { hideBook, useSignals } from '../store/signals';
import { recallBook, rememberBook, toast, useUi } from '../store/ui';
import { useWishlist } from '../store/wishlist';

/** Grob: deutscher Satz? (Der erste Satz kommt aus Open Library – oft im Original.) */
function germanish(text: string): boolean {
  const words = text.toLowerCase().split(/[^a-zäöüß]+/);
  const de = words.filter((w) => ['der', 'die', 'das', 'und', 'ich', 'nicht', 'ein', 'eine', 'war', 'ist', 'mit', 'sich', 'auf', 'zu', 'er', 'sie', 'es', 'hatte'].includes(w)).length;
  const en = words.filter((w) => ['the', 'and', 'was', 'is', 'of', 'with', 'his', 'her', 'that', 'to', 'a', 'had', 'he', 'she'].includes(w)).length;
  return de > en;
}

interface Loaded {
  book: Book;
  work?: WorkDetails;
  gb?: GBResult;
}

async function loadBook(id: string, signal: AbortSignal, apiKey: string, country: string): Promise<Loaded | { redirect: string }> {
  if (id.startsWith('gb:')) {
    const gb = await googleVolume(id.slice(3), { apiKey, country, signal });
    const cached = recallBook(id);
    const book = gb?.book ?? cached;
    if (!book) throw new Error('Dieses Buch konnte nicht geladen werden (Google Books ist nicht erreichbar).');
    // Gibt es das Werk auch bei Open Library? Dann dorthin – dort gibt es alle Ausgaben.
    const isbn = gb?.isbn13 ?? book.isbns?.[0];
    if (isbn) {
      const workId = await workForIsbn(isbn);
      if (workId) return { redirect: workId };
    }
    return { book: { ...book, description: gb?.book.description ?? book.description }, gb };
  }
  const [fromIndex, work] = await Promise.all([getBookByWorkId(id, signal), settle(getWork(id, signal))]);
  const book = fromIndex ?? recallBook(id);
  if (!book && !work) throw new Error('Buch nicht gefunden.');
  const merged: Book = book
    ? { ...book, description: work?.description ?? book.description }
    : {
        id,
        workKey: work!.key,
        title: work!.title,
        authors: [],
        subjects: work!.subjects,
        places: work!.places,
        times: work!.times,
        people: work!.people,
        coverId: work!.covers[0],
        languages: [],
        description: work!.description,
        source: 'openlibrary',
      };
  return { book: merged, work };
}

const OWN_FORMATS: OwnedFormat[] = ['print', 'ebook'];
const NO_FORMATS: OwnedFormat[] = [];

export default function BookDetail() {
  const { id = '' } = useParams();
  const [params, setParams] = useSearchParams();
  const navigate = useNavigate();
  const { language, googleApiKey, region } = useSettings();
  const readIndex = useReadIndex();
  const profile = useProfile();
  const record = useSignals((s) => s.record);
  const restoreSignal = useSignals((s) => s.restore);
  const hidden = useSignals((s) => s.signals.some((x) => x.bookId === id && x.verdict === 'hide'));
  const owned = useOwned((s) => s.items[id]?.formats) ?? NO_FORMATS;
  const toggleOwned = useOwned((s) => s.toggle);
  const saved = useWishlist((s) => Boolean(s.items[id]));
  const toggleWish = useWishlist((s) => s.toggle);
  const openRating = useUi((s) => s.openRating);
  const aiSettings = useSettings();
  const [ai, setAi] = useState<AiAccess>({ available: false });
  // Wer ein Buch öffnet, ignoriert es nicht – zählt für die Rotation der Treffer
  useEffect(() => useImpressions.getState().engage(id), [id]);
  useEffect(() => {
    aiAvailability(aiSettings).then(setAi);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [aiSettings.aiProvider, aiSettings.aiApiKey, aiSettings.geminiApiKey]);
  const aiConfig = aiConfigFor(ai, aiSettings);
  // Spätestens nach vier Sekunden mit dem Material beginnen, das schon da ist
  const [waited, setWaited] = useState(false);
  useEffect(() => {
    setWaited(false);
    const t = setTimeout(() => setWaited(true), 4000);
    return () => clearTimeout(t);
  }, [id]);

  const main = useAsync((signal) => loadBook(id, signal, googleApiKey, region), [id]);
  useEffect(() => {
    if (main.data && 'redirect' in main.data) navigate(`/buch/${main.data.redirect}`, { replace: true });
  }, [main.data, navigate]);
  const loaded = main.data && 'book' in main.data ? main.data : undefined;
  const cached = recallBook(id);
  const book = loaded?.book ?? cached;
  useEffect(() => {
    if (!loaded?.book) return;
    rememberBook(loaded.book);
    reportBook(loaded.book, 'opened');
  }, [loaded?.book]);

  const isOL = /^OL\d+W$/.test(id);
  const editionsState = useAsync(async (signal) => (isOL ? getEditions(id, 400, signal) : undefined), [id]);
  const editions: Edition[] = useMemo(() => {
    if (editionsState.data) return editionsState.data.editions;
    if (loaded?.gb) {
      const r = loaded.gb;
      return [
        {
          key: r.book.id,
          title: r.book.title,
          publishers: r.publisher ? [r.publisher] : [],
          publishDate: r.publishedDate,
          year: r.book.year,
          languages: r.book.languages,
          isbn13: r.isbn13,
          pages: r.book.pages,
          formatKind: 'other',
          coverUrl: r.book.coverUrl,
        },
      ];
    }
    return [];
  }, [editionsState.data, loaded?.gb]);

  const selectedKey = params.get('ausgabe') ?? undefined;
  const selected = useMemo(() => {
    if (!editions.length) return undefined;
    const fromUrl = editions.find((e) => e.key === selectedKey);
    if (fromUrl) return fromUrl;
    const preferred = book?.preferredEditionKey ? editions.find((e) => e.key === book.preferredEditionKey && e.isbn13) : undefined;
    // Die vom Suchindex bevorzugte Ausgabe nur nehmen, wenn sie zur Sprachwahl passt
    if (preferred && (language === 'any' || preferred.languages.includes('ger'))) return preferred;
    return pickDefaultEdition(editions, language);
  }, [editions, selectedKey, book?.preferredEditionKey, language]);

  // Deutscher Klappentext & Live-Preis über Google Books (falls verfügbar)
  const gbState = useAsync(
    async (signal) => {
      const isbn = selected?.isbn13;
      if (!isbn) return undefined;
      return (await settle(googleBookByIsbn(isbn, { apiKey: googleApiKey, country: region, signal }))) ?? undefined;
    },
    [selected?.isbn13, region],
  );

  // Titel einer deutschen Ausgabe – für Wikipedia und Anna's Archive, auch wenn gerade eine andere gewählt ist
  const germanEdition = selected?.languages.includes('ger') ? selected : pickDefaultEdition(editions.filter((e) => e.languages.includes('ger') && e.title), 'de-first');
  const germanTitle = germanEdition?.title || (book?.preferredEditionLang === 'ger' ? book.title : undefined);
  const wiki = useAsync(
    async (signal) => {
      if (!book) return undefined;
      return germanWikipediaSummary(
        { wikidataId: loaded?.work?.wikidataId, titles: [germanTitle, book.title].filter((t): t is string => Boolean(t)), author: book.authors[0] },
        signal,
      ).catch(() => undefined);
    },
    [book?.id, loaded?.work?.wikidataId, germanTitle],
  );

  // Deutscher Verlagstext aus Apple Books (über den eigenen Server, falls vorhanden)
  const publisher = useAsync(async () => (book ? publisherText(germanTitle ?? book.title, book.authors[0]) : undefined), [book?.id, germanTitle]);

  const similar = useAsync(
    async (signal) => {
      if (!book) return [];
      const subjects = distinctiveSubjects(book.subjects, 5);
      if (subjects.length < 2) return [];
      const lang = language === 'any' ? '' : ' language:ger';
      const exclude = book.workKey ? ` -key:${solrPhrase(book.workKey)}` : '';
      const res = await searchWorks(`subject:(${subjects.map(solrPhrase).join(' OR ')})${lang}${exclude}`, {
        sort: 'readinglog',
        limit: 30,
        lang: 'de',
        signal,
      });
      const books = res.docs.map((d) => docToBook(d)).filter((b) => b.id !== book.id && !readIndex.has(b));
      if (profile && profile.topConcepts.length >= 3) {
        return books
          .map((b) => scoreForProfile(b, { profile, readIndex, language }))
          .filter((x): x is NonNullable<typeof x> => Boolean(x))
          .sort((a, b) => b.score - a.score)
          .slice(0, 16);
      }
      return books.slice(0, 16);
    },
    [book?.id, book?.subjects.length],
  );

  const byAuthor = useAsync(
    async (signal) => {
      const key = book?.authorKeys?.[0];
      if (!key) return [];
      const res = await searchWorks(`author_key:${key}`, { sort: 'readinglog', limit: 20, lang: 'de', signal });
      return res.docs.map((d) => docToBook(d)).filter((b) => b.id !== book?.id);
    },
    [book?.authorKeys?.[0]],
  );

  if (main.loading && !book) return <Loading text="Buch wird geladen …" />;
  if (!book) {
    return (
      <Empty title="Buch nicht gefunden">
        <p>{errorMessage(main.error)}</p>
        <Link to="/entdecken" className="btn">
          Zur Suche
        </Link>
      </Empty>
    );
  }

  const gb = gbState.data;
  // Beschreibungen: Deutsches zuerst (Wikipedia, deutscher Klappentext), Fremdsprachiges nur auf Wunsch
  const gbGerman = gb?.language === 'ger' ? gb.book.description : undefined;
  const anyDescription = book.description ?? gb?.book.description;
  const descriptionLang = anyDescription ? guessLanguage(anyDescription) : undefined;
  const germanBlurb = gbGerman ?? publisher.data ?? (descriptionLang === 'ger' ? anyDescription : undefined);
  const description = germanBlurb ?? anyDescription;
  // Zählt nur, was vom Inhalt erzählt – eine Einleitung über Verlag und Erfolg reicht nicht
  const wikiContent = wiki.data ? contentSummary(wiki.data) : undefined;
  const germanText = Boolean(wikiContent || germanBlurb);
  // KI nur, wenn es keinen gehaltvollen deutschen Text gibt (Wikipedia, deutscher Klappentext)
  const rich = richGermanText({ wiki: wiki.data, description: anyDescription, gbGerman, publisher: publisher.data });
  const materialReady = waited || (!wiki.loading && !gbState.loading && !editionsState.loading && !publisher.loading);
  const foreignDescription = germanBlurb ? undefined : anyDescription;
  const libraryEntry = readIndex.entryFor(book);
  const subjects = displaySubjects(book.subjects, 8);
  const languages = uniq(book.languages);
  const coverFallbacks = selected?.isbn13 ? [isbnCoverUrl(selected.isbn13, 'L')] : [];
  const displayTitle = selected?.languages.includes('ger') ? selected.title || book.title : book.title;
  const original = book.originalTitle && book.originalTitle !== displayTitle ? book.originalTitle : displayTitle !== book.title ? book.title : undefined;
  const topSubject = distinctiveSubjects(book.subjects, 1)[0];
  const annas = annasArchiveLink({ annasBase: aiSettings.annasBase, title: book.title, author: book.authors[0], germanTitle });

  return (
    <div>
      <div className="detail">
        <aside className="detail-aside">
          <Cover
            title={displayTitle}
            author={book.authors[0]}
            coverId={selected?.coverId ?? book.coverId}
            src={selected?.coverUrl ?? (selected ? undefined : book.coverUrl)}
            fallbacks={[...coverFallbacks, ...(book.coverId ? [] : book.coverUrl ? [book.coverUrl] : [])]}
            isbn={selected?.isbn13 ?? book.isbns?.[0]}
            exact={Boolean(selectedKey)}
            size="L"
          />
          <div className="stack aside-main" style={{ gap: 8 }}>
            <button
              className={`btn ${saved ? 'btn-soft' : 'btn-primary'} btn-block`}
              onClick={() => {
                const added = toggleWish(book, 'Buchseite');
                if (added) record(book, 'save');
                toast(added ? 'Auf der Merkliste ♥' : 'Von der Merkliste entfernt');
              }}
            >
              {saved ? '♥ Gemerkt' : '♡ Merken'}
            </button>
            <button className="btn btn-block" onClick={() => openRating(book)}>
              {libraryEntry ? `✓ Gelesen${libraryEntry.rating ? ` · ${'★'.repeat(libraryEntry.rating)}` : ''}` : '✓ Schon gelesen'}
            </button>
            <div className="own-toggle" role="group" aria-label="In meinem Besitz">
              <span className="small muted">Besitz:</span>
              {OWN_FORMATS.map((f) => (
                <button
                  key={f}
                  type="button"
                  className={`chip ${owned.includes(f) ? 'on' : ''}`}
                  aria-pressed={owned.includes(f)}
                  onClick={() => {
                    const next = toggleOwned(book, f);
                    toast(next.length ? `In deinem Besitz: ${ownedLabel(next)}` : 'Nicht mehr in deinem Besitz');
                  }}
                >
                  {FORMAT_LABEL[f]}
                </button>
              ))}
            </div>
          </div>
          {/* Weitere Wege – auf dem Handy als kompakte Zeile unter Cover und Hauptknöpfen */}
          <div className="aside-more">
            <Link
              className="btn btn-block btn-ghost"
              to={`/entdecken?aehnlich=${encodeURIComponent(book.id)}`}
              onClick={() => rememberBook(book)}
            >
              Ähnliche suchen
            </Link>
            {topSubject && (
              <Link className="btn btn-block btn-ghost" to={`/themen?s=${encodeURIComponent(topSubject)}`}>
                Im Themen-Netz erkunden
              </Link>
            )}
            <Link className="btn btn-block btn-ghost" to={`/bibliothekar?buch=${encodeURIComponent(`${book.title} von ${book.authors[0] ?? ''}`)}`}>
              KI fragen
            </Link>
            <button
              className="btn btn-block btn-ghost"
              title={hidden ? 'Erscheint wieder in den Vorschlägen' : 'Nicht mehr vorschlagen – zählt nur leise gegen ähnliche Bücher'}
              onClick={() => {
                if (hidden) {
                  restoreSignal(book.id);
                  toast('Wird wieder vorgeschlagen');
                } else {
                  toast('Ausgeblendet – erscheint nicht mehr in den Vorschlägen', { label: 'Rückgängig', run: hideBook(book) });
                }
              }}
            >
              {hidden ? 'Wieder vorschlagen' : 'Ausblenden'}
            </button>
          </div>
        </aside>

        <div>
          {libraryEntry && (
            <div className="notice teal" style={{ marginBottom: 16 }}>
              <span>
                In deiner Bibliothek{libraryEntry.shelf === 'to-read' ? ' (will ich lesen)' : ''}
                {libraryEntry.rating ? ` – du hast ${libraryEntry.rating} ★ vergeben` : ''}
                {libraryEntry.dateRead ? `, gelesen am ${new Date(libraryEntry.dateRead).toLocaleDateString('de-CH')}` : ''}.
              </span>
            </div>
          )}
          <div className="detail-head">
            <div className="detail-head-main">
              <h1 className="detail-title">{displayTitle}</h1>
              {(selected?.subtitle || book.subtitle) && <div className="detail-sub">{selected?.subtitle || book.subtitle}</div>}
              <div className="detail-authors">
                von{' '}
                {book.authors.length
                  ? book.authors.slice(0, 4).map((a, i) => (
                      <span key={a}>
                        {i > 0 && ', '}
                        <Link to={`/entdecken?autor=${encodeURIComponent(a)}`}>{a}</Link>
                      </span>
                    ))
                  : 'Unbekannt'}
              </div>
              {original && <div className="muted small mt-1">Originaltitel: {original}</div>}
            </div>
            <a className="btn annas-btn" href={annas.url} target="_blank" rel="noopener noreferrer" title={`Bei Anna’s Archive suchen – ${annas.note}`}>
              <span>Anna’s Archive ↗</span>
              <span className="tiny muted">{annas.id === 'annas-de' ? 'nur deutsche Ausgaben' : 'alle Sprachen'}</span>
            </a>
          </div>

          <div className="detail-facts">
            {book.rating ? (
              <div className="fact">
                <b>
                  <Stars value={book.rating} />
                </b>
                <span>{book.ratingsCount} Bewertungen</span>
              </div>
            ) : null}
            {book.year && (
              <div className="fact">
                <b>{book.year}</b>
                <span>Erstausgabe</span>
              </div>
            )}
            {(selected?.pages || book.pages) && (
              <div className="fact">
                <b>{selected?.pages ?? book.pages}</b>
                <span>Seiten</span>
              </div>
            )}
            {(editionsState.data?.total ?? book.editionCount) ? (
              <div className="fact">
                <b>{editionsState.data?.total ?? book.editionCount}</b>
                <span>Ausgaben</span>
              </div>
            ) : null}
            {languages.length > 0 && (
              <div className="fact">
                <b title={languages.map(languageLabel).join(', ')}>{hasGerman(book) ? 'Deutsch' : languageLabel(languages[0])}</b>
                <span title={languages.map(languageLabel).join(', ')}>
                  {languages.length > 1 ? `und ${languages.length - 1} weitere Sprache${languages.length > 2 ? 'n' : ''}` : 'Sprache'}
                </span>
              </div>
            )}
          </div>

          {/* Worum geht's – Inhalt vor Verlagsgeschichte, Deutsches vor Fremdsprachigem */}
          {!rich && <AiBlurb book={book} description={description} wiki={wikiMaterial(wiki.data)} config={aiConfig} prominent auto ready={materialReady} />}
          {!germanText && foreignDescription && <ForeignBlurb text={foreignDescription} lang={descriptionLang} open={!aiConfig} />}
          {wiki.data && (
            <div className="about-block">
              {wiki.data.plot && wikiContent ? (
                <>
                  <div className="label">Worum es geht</div>
                  <div className="description">{wikiContent.text}</div>
                  <details className="disclosure">
                    <summary>Ganze {wiki.data.plot.heading} lesen (mit Spoilern)</summary>
                    <div className="description">{wiki.data.plot.text}</div>
                  </details>
                  <div className="label mt-1">Über das Buch</div>
                  <div className="description secondary">{wiki.data.extract}</div>
                </>
              ) : (
                <div className="description">{wiki.data.extract}</div>
              )}
              <div className="tiny muted">
                Aus der deutschsprachigen Wikipedia ·{' '}
                <a href={wiki.data.url} target="_blank" rel="noopener noreferrer">
                  Artikel lesen ↗
                </a>
              </div>
            </div>
          )}
          {germanBlurb && !wiki.data && (
            <div className="about-block">
              <div className="description">{germanBlurb}</div>
              <div className="tiny muted">Klappentext: {gbGerman ? 'Google Books' : publisher.data ? 'Verlag (über Apple Books)' : 'Open Library'}</div>
            </div>
          )}
          {rich && <AiBlurb book={book} description={description} wiki={wikiMaterial(wiki.data)} config={aiConfig} />}
          {germanText && foreignDescription && <ForeignBlurb text={foreignDescription} lang={descriptionLang} />}
          {!germanText && !foreignDescription && !wiki.data && !wiki.loading && <p className="muted">Für dieses Buch ist noch keine Beschreibung hinterlegt.</p>}
          {book.firstSentence && germanish(book.firstSentence) && (
            <figure className="first-sentence-box">
              <figcaption className="label">So beginnt das Buch</figcaption>
              <blockquote className="first-sentence">„{book.firstSentence}“</blockquote>
            </figure>
          )}

          {subjects.length > 0 && (
            <div className="mt-2">
              <div className="label">Themen</div>
              <div className="chips mt-1">
                {subjects.map((s) => (
                  <Link key={s} to={`/themen?s=${encodeURIComponent(book.subjects.find((x) => subjectLabel(x) === s) ?? s)}`} className="chip">
                    {s}
                  </Link>
                ))}
              </div>
            </div>
          )}
          {((book.places?.length ?? 0) > 0 || (book.times?.length ?? 0) > 0) && (
            <p className="small muted mt-2">
              {[
                book.places?.length ? `Schauplatz: ${book.places.slice(0, 3).join(', ')}` : '',
                book.times?.length ? `Zeit: ${book.times.slice(0, 2).join(', ')}` : '',
              ]
                .filter(Boolean)
                .join(' · ')}
            </p>
          )}

          <section className="card mt-3">
            <div className="card-title">
              <h2>Ausgaben</h2>
              <span className="muted small">Wähle eine Ausgabe – Cover, ISBN und Angebote passen sich an.</span>
            </div>
            {selected && (
              <div className="notice" style={{ marginBottom: 14 }}>
                <div>
                  <b>{selected.title || displayTitle}</b>
                  <div className="small muted">
                    {[selected.publishers[0], selected.publishDate, formatLabel(selected), selected.pages ? `${selected.pages} Seiten` : undefined, selected.isbn13 ? `ISBN ${selected.isbn13}` : undefined]
                      .filter(Boolean)
                      .join(' · ')}
                  </div>
                </div>
              </div>
            )}
            <EditionPicker
              editions={editions}
              total={editionsState.data?.total ?? editions.length}
              selectedKey={selected?.key}
              onSelect={(e) => {
                const next = new URLSearchParams(params);
                next.set('ausgabe', e.key);
                setParams(next, { replace: true });
              }}
              language={language}
              loading={editionsState.loading}
            />
          </section>

          <section className="card mt-2" id="angebote">
            <div className="card-title">
              <h2>Angebote & Bezugsquellen</h2>
            </div>
            <OffersPanel
              title={displayTitle}
              author={book.authors[0]}
              edition={selected}
              workId={isOL ? id : undefined}
              ebookPrice={gb?.price}
              priceLoading={gbState.loading && Boolean(selected?.isbn13)}
              germanTitle={germanTitle}
            />
          </section>
        </div>
      </div>

      {similar.data && similar.data.length > 0 && (
        <BookRow title="Ähnliche Bücher" subtitle="Gleiche Themen – nach deinem Geschmack sortiert, falls ein Profil vorhanden ist." items={similar.data} origin="Ähnlich" />
      )}
      {byAuthor.data && byAuthor.data.length > 0 && <BookRow title={`Mehr von ${book.authors[0]}`} items={byAuthor.data} origin="Autor:in" />}
    </div>
  );
}

function ForeignBlurb({ text, lang, open = false }: { text: string; lang?: string; open?: boolean }) {
  return (
    <details className="disclosure" open={open}>
      <summary>{lang ? `Klappentext auf ${languageLabel(lang)}` : 'Klappentext (fremdsprachig)'}</summary>
      <div className="description">{text}</div>
      <a className="small" href={deeplUrl(text, lang)} target="_blank" rel="noopener noreferrer">
        Mit DeepL übersetzen ↗
      </a>
    </details>
  );
}

/**
 * Kurze, spoilerfreie deutsche Beschreibung von der KI – gemerkt und mit den anderen Geräten geteilt.
 * Mit `auto` entsteht sie von selbst, sobald das Material (Wikipedia, Klappentext) geladen ist.
 */
function AiBlurb({
  book,
  description,
  wiki,
  config,
  prominent,
  auto,
  ready,
}: {
  book: Book;
  description?: string;
  wiki?: string;
  config?: AiConfig;
  prominent?: boolean;
  auto?: boolean;
  ready?: boolean;
}) {
  const entries = useLibraryEntries();
  const profile = useProfile();
  const view = useBlurbs((s) => s.items[book.id]);
  const nightShift = useNightShift((s) => s.available);
  const job = config ? { config, entries, profile, description, wiki } : undefined;
  useEffect(() => {
    void lookupBlurb(book.id);
  }, [book.id]);
  const start = Boolean(job && auto && ready);
  useEffect(() => {
    if (start && job) void autoBlurb(book, job);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [book.id, start]);

  if (view?.text || view?.busy || (prominent && view?.pending)) {
    return (
      <div className="about-block ai-blurb">
        <div className="label">Kurz gesagt</div>
        {view.text ? (
          view.text
            .split(/\n\s*\n/)
            .filter(Boolean)
            .map((p, i) => (
              <p key={i} className="description mb-0">
                {p.trim()}
              </p>
            ))
        ) : (
          <p className="muted small mb-0">
            <span className="spinner" /> Deutsche Kurzbeschreibung wird geschrieben …
          </p>
        )}
        {view.text && !view.busy && (
          <div className="tiny muted">
            KI-Zusammenfassung{view.model ? ` · ${view.model}` : ''} – kann Fehler enthalten.{view.note ? ` ${view.note}` : ''}
          </div>
        )}
      </div>
    );
  }
  if (!job) return null;
  return (
    <div className="about-block">
      <button className={`btn btn-sm ${prominent ? 'btn-soft' : 'btn-ghost'}`} onClick={() => void generateBlurb(book, job)}>
        {view?.error ? 'Nochmals versuchen' : 'Kurz & spoilerfrei auf Deutsch'}
      </button>
      {view?.error && (
        <p className="small muted mb-0">
          Gerade keine KI-Kurzbeschreibung möglich: {view.error}
          {nightShift ? ' Die Nachtschicht holt sie heute Nacht nach.' : ''}
        </p>
      )}
    </div>
  );
}
