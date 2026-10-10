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
import { errorMessage, useAsync, useProfile, useReadIndex } from '../lib/hooks';
import { settle } from '../lib/http';
import { docToBook, getBookByWorkId, getEditions, getWork, isbnCoverUrl, searchWorks, workForIsbn, type WorkDetails } from '../lib/openLibrary';
import { scoreForProfile } from '../lib/recommend';
import { displaySubjects, languageFlag, languageLabel, subjectLabel } from '../lib/taxonomy';
import { solrPhrase, uniq } from '../lib/text';
import type { Book, Edition } from '../lib/types';
import { useSettings } from '../store/settings';
import { deeplUrl, germanWikipediaSummary, guessLanguage } from '../lib/wikipedia';
import { useSignals } from '../store/signals';
import { recallBook, rememberBook, toast, useUi } from '../store/ui';
import { useWishlist } from '../store/wishlist';

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

export default function BookDetail() {
  const { id = '' } = useParams();
  const [params, setParams] = useSearchParams();
  const navigate = useNavigate();
  const { language, googleApiKey, region } = useSettings();
  const readIndex = useReadIndex();
  const profile = useProfile();
  const record = useSignals((s) => s.record);
  const saved = useWishlist((s) => Boolean(s.items[id]));
  const toggleWish = useWishlist((s) => s.toggle);
  const openRating = useUi((s) => s.openRating);
  const [expanded, setExpanded] = useState(false);

  const main = useAsync((signal) => loadBook(id, signal, googleApiKey, region), [id]);
  useEffect(() => {
    if (main.data && 'redirect' in main.data) navigate(`/buch/${main.data.redirect}`, { replace: true });
  }, [main.data, navigate]);
  const loaded = main.data && 'book' in main.data ? main.data : undefined;
  const cached = recallBook(id);
  const book = loaded?.book ?? cached;
  useEffect(() => {
    if (loaded?.book) rememberBook(loaded.book);
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

  const germanTitle = selected?.languages.includes('ger') ? selected.title : book?.preferredEditionLang === 'ger' ? book.title : undefined;
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
      <Empty icon="📕" title="Buch nicht gefunden">
        <p>{errorMessage(main.error)}</p>
        <Link to="/entdecken" className="btn">
          Zur Suche
        </Link>
      </Empty>
    );
  }

  const gb = gbState.data;
  const descriptionDe = gb?.language === 'ger' ? gb.book.description : undefined;
  const description = descriptionDe ?? book.description ?? gb?.book.description;
  const libraryEntry = readIndex.entryFor(book);
  const subjects = displaySubjects(book.subjects, 14);
  const languages = uniq(book.languages);
  const coverFallbacks = selected?.isbn13 ? [isbnCoverUrl(selected.isbn13, 'L')] : [];
  const displayTitle = selected?.languages.includes('ger') ? selected.title || book.title : book.title;
  const original = book.originalTitle && book.originalTitle !== displayTitle ? book.originalTitle : displayTitle !== book.title ? book.title : undefined;
  const topSubject = distinctiveSubjects(book.subjects, 1)[0];

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
            size="L"
          />
          <div className="stack" style={{ gap: 8, flex: 1 }}>
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
            <Link
              className="btn btn-block btn-ghost"
              to={`/entdecken?aehnlich=${encodeURIComponent(book.id)}`}
              onClick={() => rememberBook(book)}
            >
              🔁 Ähnliche suchen
            </Link>
            {topSubject && (
              <Link className="btn btn-block btn-ghost" to={`/themen?s=${encodeURIComponent(topSubject)}`}>
                🕸️ Im Themen-Netz erkunden
              </Link>
            )}
            <Link className="btn btn-block btn-ghost" to={`/bibliothekar?buch=${encodeURIComponent(`${book.title} von ${book.authors[0] ?? ''}`)}`}>
              ✨ KI fragen
            </Link>
          </div>
        </aside>

        <div>
          {libraryEntry && (
            <div className="notice teal" style={{ marginBottom: 16 }}>
              <span className="notice-icon">📚</span>
              <span>
                In deiner Bibliothek{libraryEntry.shelf === 'to-read' ? ' (will ich lesen)' : ''}
                {libraryEntry.rating ? ` – du hast ${libraryEntry.rating} ★ vergeben` : ''}
                {libraryEntry.dateRead ? `, gelesen am ${new Date(libraryEntry.dateRead).toLocaleDateString('de-CH')}` : ''}.
              </span>
            </div>
          )}
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
                <b title={languages.map(languageLabel).join(', ')}>
                  {languages.slice(0, 8).map(languageFlag).join(' ')}
                  {languages.length > 8 ? ' …' : ''}
                </b>
                <span>{hasGerman(book) ? 'auch auf Deutsch' : 'Sprachen'}</span>
              </div>
            )}
          </div>

          {wiki.data && (
            <div className="mb-0" style={{ marginBottom: 16 }}>
              <div className="description">{wiki.data.extract}</div>
              <div className="tiny muted mt-1">
                Aus der deutschsprachigen Wikipedia ·{' '}
                <a href={wiki.data.url} target="_blank" rel="noopener noreferrer">
                  Artikel lesen ↗
                </a>
              </div>
            </div>
          )}
          {description ? (
            (() => {
              const lang = descriptionDe ? 'ger' : guessLanguage(description);
              const foreign = lang && lang !== 'ger';
              const collapsedForeign = foreign && wiki.data && !expanded;
              return (
                <div className={wiki.data ? 'card' : ''} style={wiki.data ? { padding: 16, background: 'var(--surface-2)' } : undefined}>
                  {wiki.data && <div className="label">Klappentext{foreign ? ` (${languageLabel(lang!)})` : ''}</div>}
                  {!collapsedForeign && <div className={`description ${expanded ? '' : 'clamped'}`}>{description}</div>}
                  <div className="row wrap" style={{ gap: 6 }}>
                    {(description.length > 600 || collapsedForeign) && (
                      <button className="btn btn-ghost btn-sm" onClick={() => setExpanded((x) => !x)}>
                        {collapsedForeign ? 'Anzeigen' : expanded ? 'Weniger' : 'Weiterlesen'}
                      </button>
                    )}
                    {foreign && (
                      <a className="btn btn-ghost btn-sm" href={deeplUrl(description, lang)} target="_blank" rel="noopener noreferrer">
                        🌐 Mit DeepL übersetzen
                      </a>
                    )}
                  </div>
                  {descriptionDe && <div className="tiny muted">Klappentext: Google Books</div>}
                </div>
              );
            })()
          ) : (
            !wiki.data && !wiki.loading && <p className="muted">Für dieses Buch ist noch keine Beschreibung hinterlegt.</p>
          )}
          {book.firstSentence && <blockquote className="first-sentence">„{book.firstSentence}“</blockquote>}

          {subjects.length > 0 && (
            <div className="mt-2">
              <div className="label">Themen</div>
              <div className="chips mt-1">
                {subjects.map((s, i) => (
                  <Link key={s} to={`/themen?s=${encodeURIComponent(book.subjects.find((x) => subjectLabel(x) === s) ?? s)}`} className="chip" style={{ animationDelay: `${i * 20}ms` }}>
                    {s}
                  </Link>
                ))}
              </div>
            </div>
          )}
          {((book.places?.length ?? 0) > 0 || (book.times?.length ?? 0) > 0) && (
            <div className="row wrap mt-2" style={{ gap: 6 }}>
              {book.places?.slice(0, 6).map((p) => (
                <span key={p} className="tag teal">
                  📍 {p}
                </span>
              ))}
              {book.times?.slice(0, 4).map((t) => (
                <span key={t} className="tag gold">
                  🕰️ {t}
                </span>
              ))}
              {book.people?.slice(0, 4).map((p) => (
                <span key={p} className="tag violet">
                  🎭 {p}
                </span>
              ))}
            </div>
          )}

          <section className="card mt-3">
            <div className="card-title">
              <h2>📖 Ausgaben</h2>
              <span className="muted small">Wähle eine Ausgabe – Cover, ISBN und Angebote passen sich an.</span>
            </div>
            {selected && (
              <div className="notice" style={{ marginBottom: 14 }}>
                <span className="notice-icon">{languageFlag(selected.languages[0] ?? '')}</span>
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
              <h2>🛒 Angebote & Bezugsquellen</h2>
            </div>
            <OffersPanel
              title={displayTitle}
              author={book.authors[0]}
              edition={selected}
              workId={isOL ? id : undefined}
              ebookPrice={gb?.price}
              priceLoading={gbState.loading && Boolean(selected?.isbn13)}
            />
          </section>
        </div>
      </div>

      {similar.data && similar.data.length > 0 && (
        <BookRow title="Ähnliche Bücher" icon="🔁" subtitle="Gleiche Themen – nach deinem Geschmack sortiert, falls ein Profil vorhanden ist." items={similar.data} origin="Ähnlich" />
      )}
      {byAuthor.data && byAuthor.data.length > 0 && <BookRow title={`Mehr von ${book.authors[0]}`} icon="✍️" items={byAuthor.data} origin="Autor:in" />}
    </div>
  );
}
