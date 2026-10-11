import { useMemo } from 'react';
import type { GBPrice } from '../lib/googleBooks';
import { buildOffers, priceHint } from '../lib/shops';
import { languageFlag, languageLabel } from '../lib/taxonomy';
import type { Edition } from '../lib/types';
import { useSettings } from '../store/settings';

interface Props {
  title: string;
  author?: string;
  edition?: Edition;
  workId?: string;
  ebookPrice?: GBPrice;
  priceLoading?: boolean;
}

function formatMoney(amount: number, currency: string): string {
  try {
    return new Intl.NumberFormat('de-CH', { style: 'currency', currency }).format(amount);
  } catch {
    return `${amount.toFixed(2)} ${currency}`;
  }
}

export function OffersPanel({ title, author, edition, workId, ebookPrice, priceLoading }: Props) {
  const { region, annasBase, preferredShop } = useSettings();
  const language = edition?.languages[0];
  const groups = useMemo(
    () =>
      buildOffers({
        isbn13: edition?.isbn13,
        title: edition?.title || title,
        author,
        region,
        language,
        annasBase,
        workId,
        preferredShop,
      }),
    [edition, title, author, region, language, annasBase, workId, preferredShop],
  );
  const featured = groups.flatMap((g) => g.links).filter((l) => l.featured);

  return (
    <div className="stack">
      <div className="row wrap" style={{ gap: 8 }}>
        {edition?.isbn13 ? (
          <span className="tag teal">ISBN-genau: {edition.isbn13}</span>
        ) : (
          <span className="tag gold">Ohne ISBN – Suche über Titel & Autor</span>
        )}
        {language && (
          <span className="tag">
            {languageFlag(language)} {languageLabel(language)}
          </span>
        )}
      </div>

      <div className="grid-2">
        {featured.map((l) => (
          <a key={l.id} className="offer-link featured" href={l.url} target="_blank" rel="noopener noreferrer">
            <span>
              <span className="o-name">{l.name}</span>
              {l.note && <span className="o-note muted"> · {l.note}</span>}
            </span>
            <span aria-hidden="true">↗</span>
          </a>
        ))}
      </div>

      {(ebookPrice || priceLoading) && (
        <div className="notice teal">
          <div style={{ flex: 1 }}>
            {priceLoading ? (
              <span className="muted">Live-Preis wird abgefragt …</span>
            ) : ebookPrice ? (
              <div className="row between wrap">
                <span>
                  <b>Live-Preis Google Play:</b> <span className="price">{formatMoney(ebookPrice.amount, ebookPrice.currency)}</span>
                  {ebookPrice.listAmount && ebookPrice.listAmount > ebookPrice.amount && (
                    <span className="muted small"> statt {formatMoney(ebookPrice.listAmount, ebookPrice.currency)}</span>
                  )}
                  <span className="muted small"> · {ebookPrice.isEbook ? 'E-Book' : 'Buch'}</span>
                </span>
                {ebookPrice.buyLink && (
                  <a className="btn btn-sm" href={ebookPrice.buyLink} target="_blank" rel="noopener noreferrer">
                    Zu Google Play ↗
                  </a>
                )}
              </div>
            ) : null}
          </div>
        </div>
      )}

      <div className="offers">
        {groups
          .filter((g) => g.links.some((l) => !l.featured))
          .map((g) => (
            <div key={g.kind} className="offer-group">
              <h4>
                {g.title}
              </h4>
              {g.links
                .filter((l) => !l.featured)
                .map((l) => (
                  <a key={l.id} className="offer-link" href={l.url} target="_blank" rel="noopener noreferrer">
                    <span>
                      <span className="o-name">{l.name}</span>
                      {l.note && <div className="o-note muted">{l.note}</div>}
                    </span>
                    <span aria-hidden="true" className="muted">
                      ↗
                    </span>
                  </a>
                ))}
            </div>
          ))}
      </div>
      <p className="small muted">{priceHint(region, language)}</p>
    </div>
  );
}
