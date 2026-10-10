import { useEffect, useState } from 'react';
import { useLibrary } from '../store/library';
import { useSignals } from '../store/signals';
import { toast, useUi } from '../store/ui';
import { useWishlist } from '../store/wishlist';
import { Modal } from './Modal';
import { StarInput } from './Stars';

/** Globaler Dialog „Schon gelesen?“ mit Sternebewertung. */
export function RatingDialog() {
  const book = useUi((s) => s.ratingFor);
  const close = useUi((s) => s.closeRating);
  const addBook = useLibrary((s) => s.addBook);
  const record = useSignals((s) => s.record);
  const removeWish = useWishlist((s) => s.remove);
  const [rating, setRating] = useState(0);

  useEffect(() => setRating(0), [book?.id]);
  if (!book) return null;

  const save = () => {
    addBook(book, 'read', rating);
    record(book, rating && rating <= 2 ? 'dislike' : 'read');
    removeWish(book.id);
    toast(`„${book.title}“ in deiner Bibliothek`);
    close();
  };

  return (
    <Modal open onClose={close} label="Als gelesen markieren">
      <p className="eyebrow">Schon gelesen</p>
      <h2>{book.title}</h2>
      <p className="muted">{book.authors.join(', ')}</p>
      <p>Wie hat es dir gefallen? Deine Bewertung verfeinert die Empfehlungen.</p>
      <div className="row" style={{ justifyContent: 'center', margin: '18px 0' }}>
        <StarInput value={rating} onChange={setRating} />
      </div>
      <div className="btn-row" style={{ justifyContent: 'flex-end' }}>
        <button className="btn btn-ghost" onClick={close}>
          Abbrechen
        </button>
        <button className="btn btn-primary" onClick={save}>
          {rating ? `Mit ${rating} ★ speichern` : 'Ohne Bewertung speichern'}
        </button>
      </div>
    </Modal>
  );
}
