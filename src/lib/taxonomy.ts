/**
 * Wissensbasis für die Suche: Genres, Stimmungen, Epochen und Schauplätze –
 * jeweils mit deutschen Bezeichnungen und den passenden Open-Library-Begriffen.
 *
 * `subjects` werden für Suchanfragen verwendet (Open-Library-Schlagwörter),
 * `match` für die Bewertung der Treffer (Teilwort-Vergleich auf normalisiertem Text).
 * Ein Match-Begriff mit `*` am Ende passt als Präfix, sonst als ganzes Wort
 * (inkl. einfacher Plural-Endungen).
 */
import { normalize } from './text';

export interface Genre {
  id: string;
  label: string;
  emoji: string;
  group: 'fiction' | 'nonfiction';
  subjects: string[];
  match: string[];
  /** Begriffe, die einen Treffer wieder aufheben (z. B. „fiction“ bei Sachbuch-Genres). */
  exclude?: string[];
  /** Grob: wie rasant (+) bzw. ruhig (−) das Genre typischerweise ist. */
  tempo?: number;
  /** Grob: wie anspruchsvoll (+) bzw. leicht (−). */
  depth?: number;
}

export interface Mood {
  id: string;
  label: string;
  emoji: string;
  hint: string;
  subjects: string[];
  match: string[];
}

export interface Era {
  id: string;
  label: string;
  emoji: string;
  times: string[];
  match: string[];
}

export interface Place {
  id: string;
  label: string;
  emoji: string;
  places: string[];
  match: string[];
}

export const GENRES: Genre[] = [
  { id: 'literatur', label: 'Gegenwartsliteratur', emoji: '📖', group: 'fiction', subjects: ['literary fiction', 'fiction, literary', 'domestic fiction', 'psychological fiction'], match: ['literary', 'domestic fiction', 'psychological fiction', 'literarisch*'], tempo: -1, depth: 1 },
  { id: 'krimi', label: 'Krimi', emoji: '🕵️', group: 'fiction', subjects: ['detective and mystery stories', 'crime fiction', 'murder', 'police'], match: ['detective*', 'mystery', 'murder', 'crime', 'police', 'krimi*', 'mord*', 'kommissar*', 'investigat*'], tempo: 1 },
  { id: 'thriller', label: 'Thriller', emoji: '🔪', group: 'fiction', subjects: ['thriller', 'suspense', 'fiction, thrillers', 'psychological thriller'], match: ['thriller*', 'suspense', 'serial murder*', 'kidnapping', 'conspirac*', 'spannung'], tempo: 2, depth: -1 },
  { id: 'fantasy', label: 'Fantasy', emoji: '🐉', group: 'fiction', subjects: ['fantasy', 'fantasy fiction', 'magic', 'dragons'], match: ['fantasy', 'magic*', 'dragon*', 'wizard*', 'elves', 'quests', 'zauber*', 'drache*', 'imaginary places'], tempo: 1 },
  { id: 'scifi', label: 'Science-Fiction', emoji: '🚀', group: 'fiction', subjects: ['science fiction', 'space opera', 'artificial intelligence', 'time travel'], match: ['science fiction', 'space', 'interstellar', 'robot*', 'artificial intelligence', 'time travel', 'aliens', 'extraterrestrial', 'cyberpunk', 'mars'], tempo: 1, depth: 1 },
  { id: 'dystopie', label: 'Dystopie', emoji: '🏚️', group: 'fiction', subjects: ['dystopias', 'dystopian fiction', 'totalitarianism'], match: ['dystopi*', 'totalitarian*', 'post apocalyptic', 'apocalyp*', 'end of the world'], tempo: 1, depth: 1 },
  { id: 'horror', label: 'Horror', emoji: '👻', group: 'fiction', subjects: ['horror', 'horror tales', 'ghost stories', 'supernatural'], match: ['horror', 'ghost*', 'haunted', 'vampire*', 'demon*', 'supernatural', 'monster*', 'grusel*'], tempo: 1 },
  { id: 'historisch', label: 'Historischer Roman', emoji: '🏰', group: 'fiction', subjects: ['historical fiction', 'fiction, historical', 'history'], match: ['historical fiction', 'historical', 'histori*', 'middle ages', 'kings and rulers', 'world war*'], depth: 1 },
  { id: 'liebe', label: 'Liebesroman', emoji: '💞', group: 'fiction', subjects: ['love stories', 'romance', 'romance fiction', 'man-woman relationships'], match: ['love', 'romance', 'romantic', 'man woman relationships', 'liebe*', 'courtship', 'dating'], tempo: -1, depth: -1 },
  { id: 'humor', label: 'Humor', emoji: '😂', group: 'fiction', subjects: ['humor', 'humorous stories', 'humorous fiction', 'satire'], match: ['humor*', 'humour*', 'comic', 'comedy', 'satire', 'satiric*', 'parod*', 'wit and humor'], depth: -1 },
  { id: 'abenteuer', label: 'Abenteuer', emoji: '🧭', group: 'fiction', subjects: ['adventure stories', 'adventure and adventurers', 'action and adventure fiction', 'voyages and travels'], match: ['adventure*', 'voyage*', 'quest*', 'treasure', 'pirate*', 'explor*', 'survival', 'sea stories', 'abenteuer*'], tempo: 2 },
  { id: 'klassiker', label: 'Klassiker', emoji: '🎩', group: 'fiction', subjects: ['classic literature', 'classics'], match: ['classic*', 'klassiker'], tempo: -1, depth: 2 },
  { id: 'jugend', label: 'Jugendbuch', emoji: '🎒', group: 'fiction', subjects: ['young adult fiction', 'teenagers', 'high schools'], match: ['young adult', 'teenage*', 'high school*', 'jugend*', 'coming of age'], depth: -1 },
  { id: 'kinder', label: 'Kinderbuch', emoji: '🧸', group: 'fiction', subjects: ["children's fiction", 'juvenile fiction', "children's stories"], match: ['children*', 'juvenile', 'kinder*'], depth: -2 },
  { id: 'comic', label: 'Graphic Novel & Comic', emoji: '💥', group: 'fiction', subjects: ['graphic novels', 'comic books, strips', 'comics & graphic novels', 'manga'], match: ['graphic novel*', 'comic*', 'manga', 'cartoons and comics'], tempo: 1, depth: -1 },
  { id: 'magischer-realismus', label: 'Magischer Realismus', emoji: '🪄', group: 'fiction', subjects: ['magic realism', 'magical realism'], match: ['magic realism', 'magical realism', 'surreal*', 'fabulism'], depth: 2 },
  { id: 'mythen', label: 'Mythen & Märchen', emoji: '🧚', group: 'fiction', subjects: ['mythology', 'fairy tales', 'legends', 'folklore'], match: ['myth*', 'fairy tale*', 'legend*', 'folklore', 'gods', 'märchen', 'marchen', 'sagen'] },
  { id: 'kurzgeschichten', label: 'Kurzgeschichten', emoji: '✂️', group: 'fiction', subjects: ['short stories'], match: ['short stories', 'short story', 'erzahlungen', 'kurzgeschicht*', 'nouvelles'] },
  { id: 'familie', label: 'Familiensaga', emoji: '👨‍👩‍👧', group: 'fiction', subjects: ['family saga', 'families', 'family life', 'domestic fiction'], match: ['famil*', 'generations', 'mothers', 'fathers', 'sisters', 'brothers', 'siblings', 'inheritance'], tempo: -1 },
  { id: 'krieg', label: 'Kriegsroman', emoji: '🎖️', group: 'fiction', subjects: ['war stories', 'world war, 1939-1945', 'world war, 1914-1918', 'soldiers'], match: ['war stories', 'world war*', 'soldier*', 'battle*', 'military', 'krieg*'], depth: 1 },
  { id: 'spionage', label: 'Spionage', emoji: '🕶️', group: 'fiction', subjects: ['spy stories', 'espionage', 'intelligence service'], match: ['spy', 'spies', 'espionage', 'intelligence service', 'secret service', 'cold war', 'spion*'], tempo: 2 },
  { id: 'lyrik', label: 'Lyrik', emoji: '🪶', group: 'fiction', subjects: ['poetry', 'poems'], match: ['poetry', 'poem*', 'lyrik', 'gedicht*', 'verse'], depth: 2 },
  { id: 'biografie', label: 'Biografie & Memoir', emoji: '🧑‍🎨', group: 'nonfiction', subjects: ['biography', 'autobiography', 'memoirs'], match: ['biograph*', 'autobiograph*', 'memoir*', 'personal narratives'], exclude: ['fiction', 'novel'], depth: 1 },
  { id: 'geschichte', label: 'Geschichte (Sachbuch)', emoji: '📜', group: 'nonfiction', subjects: ['history', 'world history', 'civilization'], match: ['history', 'civilization', 'geschichte'], exclude: ['fiction', 'novel', 'roman', 'juvenile'], depth: 1 },
  { id: 'wissenschaft', label: 'Wissenschaft', emoji: '🔬', group: 'nonfiction', subjects: ['popular science', 'science', 'physics', 'biology', 'evolution'], match: ['science', 'physics', 'biology', 'evolution', 'astronomy', 'cosmology', 'brain', 'neuroscience', 'wissenschaft*'], exclude: ['fiction', 'novel', 'roman'], depth: 2 },
  { id: 'philosophie', label: 'Philosophie', emoji: '🤔', group: 'nonfiction', subjects: ['philosophy', 'ethics', 'existentialism'], match: ['philosoph*', 'ethic*', 'existential*', 'stoic*', 'meaning of life'], exclude: ['fiction', 'novel'], tempo: -2, depth: 2 },
  { id: 'psychologie', label: 'Psychologie', emoji: '🧠', group: 'nonfiction', subjects: ['psychology', 'social psychology', 'cognitive psychology'], match: ['psycholog*', 'mental health', 'behavior', 'cognition', 'emotions'], exclude: ['fiction', 'novel'], depth: 1 },
  { id: 'gesellschaft', label: 'Gesellschaft & Politik', emoji: '🏛️', group: 'nonfiction', subjects: ['politics and government', 'social conditions', 'sociology', 'feminism'], match: ['politic*', 'social conditions', 'sociolog*', 'feminis*', 'democracy', 'racism', 'inequality', 'gesellschaft*'], exclude: ['fiction', 'novel'], depth: 2 },
  { id: 'wirtschaft', label: 'Wirtschaft & Karriere', emoji: '📈', group: 'nonfiction', subjects: ['economics', 'business', 'management', 'success in business'], match: ['econom*', 'business', 'management', 'finance', 'leadership', 'wirtschaft*'], exclude: ['fiction', 'novel'] },
  { id: 'natur', label: 'Natur & Umwelt', emoji: '🌿', group: 'nonfiction', subjects: ['nature', 'natural history', 'environment', 'climate change'], match: ['natural history', 'environment*', 'climat*', 'ecology', 'forest*', 'wildlife', 'nature conservation', 'naturschutz'], exclude: ['fiction', 'novel'], tempo: -2 },
  { id: 'reise', label: 'Reise', emoji: '🗺️', group: 'nonfiction', subjects: ['travel', 'description and travel', 'voyages and travels'], match: ['description and travel', 'travel writing', 'reisebericht*', 'travelogue*'], exclude: ['fiction', 'novel'] },
  { id: 'ratgeber', label: 'Persönlichkeit & Ratgeber', emoji: '🌱', group: 'nonfiction', subjects: ['self-help', 'personal development', 'self-actualization (psychology)', 'happiness'], match: ['self help', 'self actualization', 'personal development', 'happiness', 'habits', 'mindfulness', 'success', 'ratgeber'], exclude: ['fiction', 'novel'], depth: -1 },
  { id: 'kunst', label: 'Kunst & Musik', emoji: '🎨', group: 'nonfiction', subjects: ['art', 'music', 'artists', 'architecture'], match: ['art', 'artists', 'painting', 'music*', 'architecture', 'design', 'kunst'], exclude: ['fiction', 'novel'] },
  { id: 'essen', label: 'Kochen & Genuss', emoji: '🍝', group: 'nonfiction', subjects: ['cooking', 'food', 'wine'], match: ['cooking', 'cookery', 'recipes', 'wine', 'kochen'], exclude: ['fiction', 'novel'] },
];

export const MOODS: Mood[] = [
  { id: 'spannend', label: 'spannend', emoji: '🔥', hint: 'Ich will nicht aufhören können', subjects: ['suspense', 'thriller', 'mystery'], match: ['suspense', 'thriller*', 'mystery', 'murder', 'chase', 'danger*', 'secret*', 'spannend*', 'spannung'] },
  { id: 'duester', label: 'düster', emoji: '🌑', hint: 'Schatten, Abgründe, Noir', subjects: ['noir fiction', 'gothic fiction', 'death'], match: ['noir', 'gothic', 'dark*', 'death', 'murder', 'evil', 'violence', 'despair', 'dust*', 'dunkel*', 'abgrund*'] },
  { id: 'herzerwaermend', label: 'herzerwärmend', emoji: '☀️', hint: 'Wohlfühlen, Hoffnung, Menschlichkeit', subjects: ['friendship', 'kindness', 'hope'], match: ['friendship', 'kindness', 'hope', 'compassion', 'community', 'feel good', 'heartwarming', 'freundschaft', 'herz*', 'wohlfuhl*'] },
  { id: 'humorvoll', label: 'humorvoll', emoji: '😄', hint: 'Lachen bis der Bauch wehtut', subjects: ['humor', 'humorous stories', 'satire'], match: ['humor*', 'humour*', 'comic', 'comedy', 'satir*', 'funny', 'witty', 'lustig*', 'witzig*', 'komisch*'] },
  { id: 'nachdenklich', label: 'nachdenklich', emoji: '🤔', hint: 'Bleibt lange im Kopf', subjects: ['philosophy', 'identity', 'meaning'], match: ['philosoph*', 'identity', 'meaning', 'existential*', 'ethic*', 'memory', 'time', 'conscience', 'nachdenk*', 'tiefgrundig*'] },
  { id: 'emotional', label: 'emotional', emoji: '💔', hint: 'Taschentücher bereithalten', subjects: ['grief', 'loss', 'death'], match: ['grief', 'loss', 'death', 'mourning', 'illness', 'tragedy', 'trauer*', 'verlust*', 'traurig*', 'beruhrend*'] },
  { id: 'magisch', label: 'magisch', emoji: '✨', hint: 'Verzauberung und Staunen', subjects: ['magic', 'fairy tales', 'magic realism'], match: ['magic*', 'fairy*', 'enchant*', 'wonder*', 'myth*', 'zauber*', 'magisch*'] },
  { id: 'abenteuerlich', label: 'abenteuerlich', emoji: '🧭', hint: 'Aufbruch ins Unbekannte', subjects: ['adventure stories', 'voyages and travels', 'quests (expeditions)'], match: ['adventure*', 'voyage*', 'quest*', 'journey*', 'expedition*', 'explor*', 'abenteuer*', 'reise*'] },
  { id: 'romantisch', label: 'romantisch', emoji: '💘', hint: 'Herzklopfen garantiert', subjects: ['love stories', 'romance', 'love'], match: ['love', 'romance', 'romantic', 'courtship', 'passion', 'liebe*', 'romant*'] },
  { id: 'raetselhaft', label: 'rätselhaft', emoji: '🗝️', hint: 'Geheimnisse, Puzzles, Wendungen', subjects: ['mystery', 'secrets', 'puzzles'], match: ['mystery', 'mysteries', 'secret*', 'puzzle*', 'riddle*', 'enigma*', 'conspirac*', 'geheimnis*', 'ratsel*'] },
  { id: 'ruhig', label: 'ruhig & gemütlich', emoji: '🫖', hint: 'Langsam, warm, entschleunigt', subjects: ['country life', 'small town life', 'village life'], match: ['country life', 'small town*', 'village*', 'cozy', 'cosy', 'gardening', 'nature', 'seasons', 'gemutlich*', 'ruhig*'] },
  { id: 'rasant', label: 'rasant', emoji: '⚡', hint: 'Action, Tempo, Cliffhanger', subjects: ['action and adventure fiction', 'thriller'], match: ['action', 'chase', 'thriller*', 'fight*', 'escape*', 'heist*', 'rasant*', 'actionreich*'] },
  { id: 'skurril', label: 'skurril', emoji: '🎭', hint: 'Absurd, schräg, überraschend', subjects: ['absurd', 'satire', 'surrealism'], match: ['absurd*', 'surreal*', 'satir*', 'eccentric*', 'bizarre', 'whimsical', 'skurril*', 'schrag*'] },
  { id: 'gruselig', label: 'gruselig', emoji: '😱', hint: 'Gänsehaut beim Lesen', subjects: ['horror', 'ghost stories', 'supernatural'], match: ['horror', 'ghost*', 'haunted', 'supernatural', 'monster*', 'creepy', 'terror', 'grusel*', 'unheimlich*'] },
  { id: 'inspirierend', label: 'inspirierend', emoji: '💪', hint: 'Mut machen und Kraft geben', subjects: ['courage', 'inspiration', 'self-realization'], match: ['courage', 'inspiration*', 'resilience', 'self realization', 'hope', 'success', 'triumph', 'inspirier*', 'mut'] },
  { id: 'lehrreich', label: 'lehrreich', emoji: '🧠', hint: 'Klüger aus dem Buch kommen', subjects: ['popular science', 'history', 'nonfiction'], match: ['science', 'history', 'nonfiction', 'education', 'knowledge', 'lehrreich*', 'wissen*'] },
  { id: 'nostalgisch', label: 'nostalgisch', emoji: '🕰️', hint: 'Kindheit, Erinnerung, früher', subjects: ['childhood', 'memory', 'nostalgia'], match: ['childhood', 'memor*', 'nostalgi*', 'growing up', 'summer', 'kindheit', 'erinnerung*'] },
  { id: 'gesellschaftskritisch', label: 'gesellschaftskritisch', emoji: '📣', hint: 'Spiegel der Gesellschaft', subjects: ['social problems', 'social classes', 'racism'], match: ['social problem*', 'social class*', 'racism', 'injustice', 'poverty', 'oppression', 'politic*', 'gesellschaftskrit*'] },
];

export const ERAS: Era[] = [
  { id: 'antike', label: 'Antike', emoji: '🏺', times: ['Antiquity', 'To 476', 'Rome', 'Greece'], match: ['antiquity', 'ancient', 'rome', 'roman empire', 'greece', 'egypt', 'antike'] },
  { id: 'mittelalter', label: 'Mittelalter', emoji: '⚔️', times: ['Middle Ages', 'Medieval', 'To 1500', '1066-1485'], match: ['middle ages', 'medieval', 'knight*', 'crusade*', 'vikings', 'to 1500', 'mittelalter*'] },
  { id: 'fruehe-neuzeit', label: 'Renaissance & Barock', emoji: '🎨', times: ['16th century', '17th century', 'Renaissance', '1558-1603'], match: ['16th century', '17th century', 'renaissance', 'tudor*', 'elizabethan', 'baroque', 'reformation'] },
  { id: '18jh', label: '18. Jahrhundert', emoji: '🕯️', times: ['18th century', 'French Revolution', '1789-1799'], match: ['18th century', 'french revolution', 'enlightenment', 'georgian'] },
  { id: '19jh', label: '19. Jahrhundert', emoji: '🎩', times: ['19th century', 'Victorian era', '1800-1899'], match: ['19th century', 'victorian', 'regency', 'industrial revolution', 'civil war'] },
  { id: 'weltkriege', label: '1900–1945', emoji: '📻', times: ['20th century', 'World War, 1914-1918', 'World War, 1939-1945', '1918-1933', '1933-1945'], match: ['world war 1914 1918', 'world war 1939 1945', '1920s', '1930s', 'weimar', 'holocaust', 'nazi*'] },
  { id: 'nachkrieg', label: '1945–1989', emoji: '📺', times: ['1945-', 'Cold War', '1945-1989', '1960s', '1970s'], match: ['cold war', '1945', '1950s', '1960s', '1970s', '1980s', 'ddr', 'german democratic republic', 'nachkrieg*'] },
  { id: 'gegenwart', label: 'Gegenwart', emoji: '📱', times: ['21st century', '1990-', '2000-'], match: ['21st century', 'contemporary', 'internet', 'social media', 'gegenwart*'] },
  { id: 'zukunft', label: 'Zukunft', emoji: '🛸', times: ['Future', 'Twenty-first century', 'Twenty-second century'], match: ['future', 'futur*', 'space', 'dystopi*', 'science fiction', 'zukunft*'] },
];

export const PLACES: Place[] = [
  { id: 'deutschland', label: 'Deutschland', emoji: '🇩🇪', places: ['Germany', 'Berlin', 'Munich', 'Hamburg'], match: ['germany', 'berlin', 'munich', 'hamburg', 'deutschland', 'bavaria', 'cologne'] },
  { id: 'schweiz', label: 'Schweiz', emoji: '🇨🇭', places: ['Switzerland', 'Zurich', 'Geneva', 'Alps'], match: ['switzerland', 'zurich', 'geneva', 'bern', 'alps', 'schweiz', 'basel', 'lucerne'] },
  { id: 'oesterreich', label: 'Österreich', emoji: '🇦🇹', places: ['Austria', 'Vienna'], match: ['austria', 'vienna', 'wien', 'salzburg', 'osterreich'] },
  { id: 'skandinavien', label: 'Skandinavien', emoji: '❄️', places: ['Sweden', 'Norway', 'Denmark', 'Iceland', 'Finland', 'Scandinavia'], match: ['sweden', 'norway', 'denmark', 'iceland', 'finland', 'scandinavia', 'stockholm', 'oslo', 'copenhagen'] },
  { id: 'britannien', label: 'Britannien & Irland', emoji: '☂️', places: ['England', 'London', 'Scotland', 'Ireland', 'Great Britain'], match: ['england', 'london', 'scotland', 'ireland', 'great britain', 'wales', 'oxford', 'dublin'] },
  { id: 'frankreich', label: 'Frankreich', emoji: '🥐', places: ['France', 'Paris'], match: ['france', 'paris', 'provence', 'normandy', 'frankreich'] },
  { id: 'italien', label: 'Italien', emoji: '🍋', places: ['Italy', 'Rome', 'Venice', 'Florence', 'Sicily', 'Naples'], match: ['italy', 'rome', 'venice', 'florence', 'sicily', 'naples', 'italien'] },
  { id: 'iberien', label: 'Spanien & Portugal', emoji: '💃', places: ['Spain', 'Barcelona', 'Madrid', 'Portugal', 'Lisbon'], match: ['spain', 'barcelona', 'madrid', 'portugal', 'lisbon', 'andalusia', 'spanien'] },
  { id: 'osteuropa', label: 'Osteuropa & Russland', emoji: '🪆', places: ['Russia', 'Soviet Union', 'Poland', 'Ukraine', 'Czech Republic'], match: ['russia', 'soviet union', 'moscow', 'poland', 'ukraine', 'prague', 'hungary', 'balkan*', 'russland'] },
  { id: 'usa', label: 'USA', emoji: '🗽', places: ['United States', 'New York (N.Y.)', 'California', 'Texas'], match: ['united states', 'new york', 'california', 'texas', 'chicago', 'america', 'mississippi', 'alaska'] },
  { id: 'lateinamerika', label: 'Lateinamerika', emoji: '🌶️', places: ['Latin America', 'Mexico', 'Brazil', 'Argentina', 'Colombia', 'Chile'], match: ['latin america', 'mexico', 'brazil', 'argentina', 'colombia', 'chile', 'peru', 'cuba'] },
  { id: 'afrika', label: 'Afrika', emoji: '🌍', places: ['Africa', 'Nigeria', 'South Africa', 'Kenya', 'Egypt'], match: ['africa', 'nigeria', 'south africa', 'kenya', 'egypt', 'congo', 'ghana', 'ethiopia', 'afrika'] },
  { id: 'nahost', label: 'Naher Osten', emoji: '🕌', places: ['Middle East', 'Israel', 'Iran', 'Turkey', 'Afghanistan'], match: ['middle east', 'israel', 'iran', 'turkey', 'istanbul', 'afghanistan', 'iraq', 'syria', 'lebanon'] },
  { id: 'indien', label: 'Indien', emoji: '🪷', places: ['India', 'Bombay (India)', 'Pakistan'], match: ['india', 'bombay', 'mumbai', 'delhi', 'calcutta', 'pakistan', 'bengal', 'indien'] },
  { id: 'ostasien', label: 'China, Japan & Korea', emoji: '🏮', places: ['Japan', 'China', 'Korea', 'Tokyo'], match: ['japan', 'tokyo', 'china', 'beijing', 'shanghai', 'korea', 'hong kong', 'taiwan'] },
  { id: 'meer', label: 'Meer & Inseln', emoji: '🏝️', places: ['Islands', 'Sea', 'Ocean'], match: ['island*', 'sea', 'ocean', 'ships', 'coast*', 'insel*', 'meer'] },
  { id: 'weltraum', label: 'Weltraum', emoji: '🪐', places: ['Outer space', 'Mars (Planet)', 'Space'], match: ['outer space', 'space', 'mars', 'planet*', 'galax*', 'space ships', 'weltraum'] },
  { id: 'fantasiewelt', label: 'Fantasiewelten', emoji: '🗺️', places: ['Imaginary places', 'Middle Earth (Imaginary place)'], match: ['imaginary place*', 'imaginary', 'middle earth', 'fantasy world', 'kingdom*'] },
];

/** Englische Open-Library-Schlagwörter → deutsche Anzeige. */
const SUBJECT_DE: Record<string, string> = {
  fiction: 'Belletristik',
  'fantasy fiction': 'Fantasy',
  fantasy: 'Fantasy',
  'science fiction': 'Science-Fiction',
  'detective and mystery stories': 'Krimi',
  mystery: 'Mystery',
  'mystery fiction': 'Mystery',
  'crime fiction': 'Krimi',
  thriller: 'Thriller',
  thrillers: 'Thriller',
  suspense: 'Spannung',
  'love stories': 'Liebesgeschichte',
  romance: 'Romanze',
  'historical fiction': 'Historischer Roman',
  horror: 'Horror',
  'horror tales': 'Horror',
  'ghost stories': 'Geistergeschichten',
  magic: 'Magie',
  dragons: 'Drachen',
  wizards: 'Zauberer',
  witches: 'Hexen',
  vampires: 'Vampire',
  friendship: 'Freundschaft',
  families: 'Familie',
  family: 'Familie',
  'family life': 'Familienleben',
  death: 'Tod',
  love: 'Liebe',
  war: 'Krieg',
  'world war, 1939-1945': 'Zweiter Weltkrieg',
  'world war, 1914-1918': 'Erster Weltkrieg',
  "children's fiction": 'Kinderbuch',
  'juvenile fiction': 'Kinder- & Jugendbuch',
  'juvenile literature': 'Kinder- & Jugendsachbuch',
  'young adult fiction': 'Jugendbuch',
  humor: 'Humor',
  'humorous stories': 'Humor',
  satire: 'Satire',
  philosophy: 'Philosophie',
  history: 'Geschichte',
  biography: 'Biografie',
  autobiography: 'Autobiografie',
  psychology: 'Psychologie',
  science: 'Wissenschaft',
  politics: 'Politik',
  'politics and government': 'Politik',
  'social life and customs': 'Alltag & Gesellschaft',
  'man-woman relationships': 'Beziehungen',
  'mothers and daughters': 'Mütter & Töchter',
  'mothers and sons': 'Mütter & Söhne',
  'fathers and sons': 'Väter & Söhne',
  'fathers and daughters': 'Väter & Töchter',
  'brothers and sisters': 'Geschwister',
  sisters: 'Schwestern',
  brothers: 'Brüder',
  murder: 'Mord',
  police: 'Polizei',
  detectives: 'Ermittler',
  'private investigators': 'Privatdetektive',
  women: 'Frauen',
  girls: 'Mädchen',
  boys: 'Jungen',
  schools: 'Schule',
  orphans: 'Waisen',
  'time travel': 'Zeitreise',
  'outer space': 'Weltraum',
  robots: 'Roboter',
  'artificial intelligence': 'Künstliche Intelligenz',
  dystopias: 'Dystopie',
  survival: 'Überleben',
  adventure: 'Abenteuer',
  'adventure stories': 'Abenteuer',
  'adventure and adventurers': 'Abenteurer',
  'sea stories': 'Seefahrt',
  pirates: 'Piraten',
  animals: 'Tiere',
  dogs: 'Hunde',
  cats: 'Katzen',
  nature: 'Natur',
  travel: 'Reisen',
  'voyages and travels': 'Reisen',
  'books and reading': 'Bücher & Lesen',
  books: 'Bücher',
  secrets: 'Geheimnisse',
  memory: 'Erinnerung',
  grief: 'Trauer',
  loss: 'Verlust',
  identity: 'Identität',
  'coming of age': 'Erwachsenwerden',
  bildungsromans: 'Bildungsroman',
  'short stories': 'Kurzgeschichten',
  poetry: 'Lyrik',
  essays: 'Essays',
  'classic literature': 'Klassiker',
  classics: 'Klassiker',
  'literary fiction': 'Literarisch',
  'magic realism': 'Magischer Realismus',
  mythology: 'Mythologie',
  'fairy tales': 'Märchen',
  legends: 'Sagen',
  'kings and rulers': 'Könige & Herrscher',
  'knights and knighthood': 'Ritter',
  'middle ages': 'Mittelalter',
  quests: 'Queste',
  'good and evil': 'Gut & Böse',
  religion: 'Religion',
  art: 'Kunst',
  artists: 'Künstler',
  music: 'Musik',
  authors: 'Schriftsteller',
  writers: 'Schriftsteller',
  crime: 'Verbrechen',
  'serial murderers': 'Serienmörder',
  revenge: 'Rache',
  spies: 'Spione',
  espionage: 'Spionage',
  conspiracies: 'Verschwörungen',
  'small town life': 'Kleinstadtleben',
  'city and town life': 'Stadtleben',
  poverty: 'Armut',
  immigrants: 'Einwanderung',
  racism: 'Rassismus',
  slavery: 'Sklaverei',
  'holocaust, jewish (1939-1945)': 'Holocaust',
  refugees: 'Flucht',
  'mental illness': 'Psychische Erkrankung',
  marriage: 'Ehe',
  divorce: 'Scheidung',
  adultery: 'Ehebruch',
  'graphic novels': 'Graphic Novel',
  'comic books, strips, etc.': 'Comics',
  cooking: 'Kochen',
  'self-help': 'Ratgeber',
  business: 'Wirtschaft',
  economics: 'Wirtschaft',
  happiness: 'Glück',
  nonfiction: 'Sachbuch',
  'social classes': 'Soziale Schichten',
  'interpersonal relations': 'Zwischenmenschliches',
  'good and evil, fiction': 'Gut & Böse',
  'imaginary places': 'Fantasiewelten',
  'imaginary wars and battles': 'Fantasiekriege',
  'space warfare': 'Weltraumkrieg',
  'life on other planets': 'Leben auf anderen Planeten',
  'interplanetary voyages': 'Weltraumreisen',
  'human-alien encounters': 'Erstkontakt',
  totalitarianism: 'Totalitarismus',
  'country life': 'Landleben',
  'teenage girls': 'Teenagerinnen',
  teenagers: 'Teenager',
  'high schools': 'Highschool',
  'interpersonal relationships': 'Zwischenmenschliches',
  'single women': 'Single-Frauen',
  'young women': 'Junge Frauen',
  'young men': 'Junge Männer',
  'gay men': 'Schwule Männer',
  lesbians: 'Lesben',
  'domestic fiction': 'Familienroman',
  'psychological fiction': 'Psychologischer Roman',
  'war stories': 'Kriegsgeschichten',
  soldiers: 'Soldaten',
  'cold war': 'Kalter Krieg',
  'action and adventure': 'Action & Abenteuer',
  'mystery and detective': 'Krimi',
  historical: 'Historisch',
  'sci fi': 'Science-Fiction',
  'science fiction and fantasy': 'Science-Fiction & Fantasy',
  'self improvement': 'Selbstverbesserung',
  'personal development': 'Persönlichkeitsentwicklung',
  'social science': 'Sozialwissenschaft',
  'young adult': 'Jugendbuch',
  'magical realism': 'Magischer Realismus',
  'fairy tale': 'Märchen',
  'world war ii': 'Zweiter Weltkrieg',
  'world war i': 'Erster Weltkrieg',
  dystopia: 'Dystopie',
  space: 'Weltraum',
  horses: 'Pferde',
  'historical fiction, general': 'Historischer Roman',
  'united states': 'USA',
  sachbuch: 'Sachbuch',
};

/** Rauschen in Open-Library-Schlagwörtern, das weder angezeigt noch gewertet wird. */
const NOISE_PATTERNS: RegExp[] = [
  /^accessible book$/,
  /^protected daisy$/,
  /^in library$/,
  /^lending library$/,
  /^large type books$/,
  /^open library staff picks$/,
  /^internet archive wishlist$/,
  /^overdrive$/,
  /^long now manual for civilization$/,
  /^reading level/,
  /^nyt[:\s]/,
  /new york times/,
  /^fiction,? general$/,
  /^general$/,
  /^(roman|romans|novela|novelas|ficcion|fiction in [a-z]+|literatura|literature|novel|novels)$/,
  /^translations into/,
  /language materials/,
  /^[a-z]+ language$/,
  /^(american|english|german|french|spanish|british) (fiction|literature)/,
  /^award/,
  /^textbooks?$/,
  /^bestseller/,
  /^fiction$/,
  /^belletristik$/,
  /^erzahlende literatur$/,
  /^deutsche literatur$/,
  /^juvenile fiction$/,
  /^fiction[,\s]+(general|literary)$/,
  /^ebooks?$/,
  /^large print/,
  /^audiobooks?/,
  /^hörbuch/,
  /^\d+$/,
  /^to read$/,
  /^currently reading$/,
  /^read$/,
  /^favou?rites?$/,
  /^series\b/,
  /^romans? nouvelles$/,
  /^(nouvelles|novelas?|romanzi?|romans?)$/,
  /^fiction (general|literary)$/,
  /^literary collections$/,
  /^(ficcion|fiction) juvenil$/,
  /^open syllabus/,
  /^kindle/,
  /^book club/,
  /^(men|women|people|man|woman)$/,
  /authors?$/,
];

export function isNoiseSubject(subject: string): boolean {
  // Maschinen-Tags wie "nyt:…", "collectionid:…", "series:…"
  if (/^[\w-]+:\S/.test(subject.trim())) return true;
  const n = normalize(subject);
  if (!n || n.length < 3) return true;
  return NOISE_PATTERNS.some((re) => re.test(n));
}

/** Deutsche Anzeigeform eines Schlagworts (Original, falls keine Übersetzung). */
export function subjectLabel(subject: string): string {
  const key = subject.toLowerCase().trim();
  if (SUBJECT_DE[key]) return SUBJECT_DE[key];
  // Schrittweise vereinfachen und nach jedem Schritt im Wörterbuch nachsehen:
  // "Fiction, science fiction, general" → "science fiction, general" → "science fiction"
  const steps: Array<(x: string) => string> = [
    (x) => x.replace(/\s*\((fictitious|legendary) characters?\)/g, ''),
    (x) => x.replace(/^(juvenile )?fiction,\s*/, ''),
    (x) => x.replace(/,\s*general$/, ''),
    (x) => x.replace(/\s*&\s*/g, ' and '),
    (x) => x.replace(/\s+in (fiction|literature)$/, ''),
    (x) => x.replace(/,?\s*fiction$/, ''),
  ];
  let simplified = key;
  for (const step of steps) {
    simplified = step(simplified).trim();
    if (SUBJECT_DE[simplified]) return SUBJECT_DE[simplified];
  }
  const parts = simplified.split(/,\s*/);
  if (parts.length > 1 && SUBJECT_DE[parts[0]]) return SUBJECT_DE[parts[0]];
  const base = simplified || subject;
  // Ursprüngliche Gross-/Kleinschreibung beibehalten, wo möglich
  const original = subject.replace(/\s*\((fictitious|legendary) characters?\)/i, '').trim();
  const display = original.toLowerCase().startsWith(base) ? original.slice(0, base.length) : base;
  return display.charAt(0).toUpperCase() + display.slice(1);
}

/** Schlagwörter für die Anzeige: ohne Rauschen, übersetzt, ohne Dubletten. */
export function displaySubjects(subjects: string[], max = 8): string[] {
  const out: string[] = [];
  const seen = new Set<string>();
  for (const s of subjects) {
    if (isNoiseSubject(s)) continue;
    if (s.length > 40) continue;
    const label = subjectLabel(s);
    const k = normalize(label);
    if (seen.has(k)) continue;
    seen.add(k);
    out.push(label);
    if (out.length >= max) break;
  }
  return out;
}

/**
 * Zerlegt Schlagwörter in vergleichbare „Konzepte“:
 * "Fiction, fantasy, epic" → ["fantasy", "epic"]; "Fantasy fiction" → ["fantasy"].
 */
export function subjectConcepts(subject: string): string[] {
  if (isNoiseSubject(subject)) return [];
  const parts = subject
    .toLowerCase()
    .replace(/&/g, ' and ')
    .split(/\s*(?:,|\/|--|;|\(|\))\s*/);
  const out: string[] = [];
  for (const part of parts) {
    let n = normalize(part)
      .replace(/\b(fiction|stories|literature|general|novel|novels)\b/g, ' ')
      .replace(/\s+/g, ' ')
      .trim();
    if (n.length < 3 || /^\d+$/.test(n)) continue;
    if (['juvenile', 'english', 'american', 'translations', 'large type', 'books', 'english language'].includes(n)) continue;
    n = CONCEPT_ALIASES[n] ?? n;
    out.push(n);
  }
  return out;
}

const CONCEPT_ALIASES: Record<string, string> = {
  'detective and mystery': 'mystery',
  'detective and mystery stories': 'mystery',
  mysteries: 'mystery',
  'love stories': 'romance',
  love: 'romance',
  'romance fiction': 'romance',
  'science fiction': 'science fiction',
  sf: 'science fiction',
  thrillers: 'thriller',
  'horror tales': 'horror',
  'ghost': 'ghosts',
  families: 'family',
  'family life': 'family',
  humorous: 'humor',
  'humorous stories': 'humor',
  'wit and humor': 'humor',
  'adventure and adventurers': 'adventure',
  'action and adventure': 'adventure',
  'adventure stories': 'adventure',
  'voyages and travels': 'travel',
  'world war 1939 1945': 'world war ii',
  'world war 1914 1918': 'world war i',
  'magic realism': 'magical realism',
  'fairy tales': 'fairy tale',
  'dystopias': 'dystopia',
  'dystopian': 'dystopia',
  'young adult': 'young adult',
  'teenagers': 'young adult',
};

/** Kompiliert Match-Begriffe zu regulären Ausdrücken (gecacht). */
const regexCache = new Map<string, RegExp>();
export function matchRegex(term: string): RegExp {
  let re = regexCache.get(term);
  if (!re) {
    const prefix = term.endsWith('*');
    const core = normalize(prefix ? term.slice(0, -1) : term).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    re = prefix ? new RegExp(`\\b${core}`) : new RegExp(`\\b${core}(s|es|en|e|n)?\\b`);
    regexCache.set(term, re);
  }
  return re;
}

/** Zählt, wie viele der Begriffe im (normalisierten) Text vorkommen. */
export function countMatches(normalizedText: string, terms: string[]): number {
  let hits = 0;
  for (const t of terms) if (matchRegex(t).test(normalizedText)) hits++;
  return hits;
}

export const genreById = (id: string) => GENRES.find((g) => g.id === id);
export const moodById = (id: string) => MOODS.find((m) => m.id === id);
export const eraById = (id: string) => ERAS.find((e) => e.id === id);
export const placeById = (id: string) => PLACES.find((p) => p.id === id);

/** Passt ein Genre auf den (normalisierten) Text? Berücksichtigt Ausschlussbegriffe. */
export function genreMatches(normalizedText: string, g: Genre): boolean {
  if (countMatches(normalizedText, g.match) === 0) return false;
  return !g.exclude || countMatches(normalizedText, g.exclude) === 0;
}

/** Ordnet einem Buch anhand seiner Schlagwörter Genres zu (für Statistik & Profil). */
export function detectGenres(normalizedText: string): string[] {
  return GENRES.filter((g) => genreMatches(normalizedText, g)).map((g) => g.id);
}

/** Sprachcodes → deutsche Namen und Flaggen. */
export const LANGUAGES: Record<string, { label: string; flag: string }> = {
  ger: { label: 'Deutsch', flag: '🇩🇪' },
  eng: { label: 'Englisch', flag: '🇬🇧' },
  fre: { label: 'Französisch', flag: '🇫🇷' },
  spa: { label: 'Spanisch', flag: '🇪🇸' },
  ita: { label: 'Italienisch', flag: '🇮🇹' },
  por: { label: 'Portugiesisch', flag: '🇵🇹' },
  dut: { label: 'Niederländisch', flag: '🇳🇱' },
  swe: { label: 'Schwedisch', flag: '🇸🇪' },
  nor: { label: 'Norwegisch', flag: '🇳🇴' },
  dan: { label: 'Dänisch', flag: '🇩🇰' },
  fin: { label: 'Finnisch', flag: '🇫🇮' },
  pol: { label: 'Polnisch', flag: '🇵🇱' },
  rus: { label: 'Russisch', flag: '🇷🇺' },
  jpn: { label: 'Japanisch', flag: '🇯🇵' },
  chi: { label: 'Chinesisch', flag: '🇨🇳' },
  kor: { label: 'Koreanisch', flag: '🇰🇷' },
  tur: { label: 'Türkisch', flag: '🇹🇷' },
  gre: { label: 'Griechisch', flag: '🇬🇷' },
  heb: { label: 'Hebräisch', flag: '🇮🇱' },
  ara: { label: 'Arabisch', flag: '🇸🇦' },
  cze: { label: 'Tschechisch', flag: '🇨🇿' },
  hun: { label: 'Ungarisch', flag: '🇭🇺' },
  lat: { label: 'Latein', flag: '🏛️' },
};

/** Google Books liefert ISO-639-1 ("de"), Open Library ISO-639-2/B ("ger"). */
const ISO1_TO_2: Record<string, string> = {
  de: 'ger', en: 'eng', fr: 'fre', es: 'spa', it: 'ita', pt: 'por', nl: 'dut', sv: 'swe', no: 'nor', nb: 'nor', da: 'dan',
  fi: 'fin', pl: 'pol', ru: 'rus', ja: 'jpn', zh: 'chi', ko: 'kor', tr: 'tur', el: 'gre', he: 'heb', ar: 'ara', cs: 'cze', hu: 'hun', la: 'lat',
};
export function iso1to2(code: string | undefined): string | undefined {
  if (!code) return undefined;
  return ISO1_TO_2[code.toLowerCase().slice(0, 2)] ?? code;
}

export function languageLabel(code: string): string {
  return LANGUAGES[code]?.label ?? code;
}
export function languageFlag(code: string): string {
  return LANGUAGES[code]?.flag ?? '🌐';
}
