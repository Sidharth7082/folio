/** Shapes returned by the catalogue queries. */

export type CatalogueSort = "books" | "title" | "newest";

export interface CatalogueSeries {
  id: number;
  /** Best available display title: English, else Japanese, else romaji. */
  title: string;
  titleEn: string | null;
  titleJa: string | null;
  romaji: string | null;
  status: string;
  numBooks: number;
  authors: string[];
  tags: string[];
  startDate: number | null;
  endDate: number | null;
  hasCover: boolean;
  /** RanobeDB image filename; serve it through `/api/cover/<filename>`. */
  coverFilename: string | null;
  /** RanobeDB's own average score (0-10), or null when it has no scores. */
  rating: number | null;
  /** RanobeDB's popularity rank weight; higher is more popular. */
  popularity: number | null;
}

/** A single volume (book) inside a series. */
export interface CatalogueVolume {
  id: number;
  seriesId: number | null;
  sortOrder: number;
  title: string;
  titleEn: string | null;
  titleJa: string | null;
  romaji: string | null;
  description: string;
  releaseDate: number | null;
  olang: string | null;
  coverFilename: string | null;
}

/** One person credited on a volume, with the role they are credited for. */
export interface CatalogueCredit {
  staffId: number;
  name: string;
  romaji: string | null;
  role: string;
  /** Human label for `role`, e.g. `author` becomes "Author". */
  roleLabel: string;
  /** True when the credit names someone other than the series' own author. */
  isTranslator: boolean;
}

/** A publisher or one of its imprints. */
export interface CataloguePublisherRef {
  id: number;
  name: string;
  romaji: string | null;
  lang: string | null;
  website: string | null;
  /** `publisher` or `imprint` as RanobeDB records it. */
  publisherType: string;
}

/** A dated release, which is what links a volume to shops and publishers. */
export interface CatalogueRelease {
  id: number;
  releaseDate: number | null;
  format: string | null;
  lang: string | null;
  title: string | null;
  romaji: string | null;
  isbn13: string | null;
  website: string | null;
  pages: number | null;
  publisherNames: string[];
}

export interface CatalogueSeriesDetail extends CatalogueSeries {
  description: string;
  malId: number | null;
  anilistId: number | null;
  imageFilename: string | null;
  webNovel: boolean;
  fullyTranslated: boolean;
  genres: string[];
  demographics: string[];
  volumes: CatalogueVolume[];
  credits: CatalogueCredit[];
  publishers: CataloguePublisherRef[];
  releases: CatalogueRelease[];
}

/** A volume with everything the volume page shows. */
export interface CatalogueVolumeDetail extends CatalogueVolume {
  seriesTitle: string | null;
  credits: CatalogueCredit[];
  publishers: CataloguePublisherRef[];
  releases: CatalogueRelease[];
  titles: CatalogueTitle[];
  /** Previous and next volume in reading order, for navigation. */
  previous: { id: number; title: string } | null;
  next: { id: number; title: string } | null;
}

/** Every name a volume is known by, in every language. */
export interface CatalogueTitle {
  lang: string | null;
  official: boolean;
  title: string | null;
  romaji: string | null;
}

export interface CataloguePage {
  items: CatalogueSeries[];
  total: number;
  page: number;
  pageSize: number;
  totalPages: number;
}

export interface CatalogueTagCount {
  name: string;
  count: number;
}

export interface CatalogueStats {
  series: number;
  withEnglishTitle: number;
  tags: number;
  generatedAt: string | null;
  sourceFile: string | null;
  /** Volumes, releases, credits and publishers carried by the import. */
  books: number;
  releases: number;
  staff: number;
  publishers: number;
  /** Rows the importer could not decode unambiguously. */
  malformedRows: number;
}

export interface CatalogueQuery {
  q?: string;
  tag?: string;
  status?: string;
  sort?: CatalogueSort;
  page?: number;
  pageSize?: number;
}
