declare module "app-store-scraper" {
  type SearchOptions = {
    term: string;
    num?: number;
    country?: string;
    lang?: string;
    device?: string;
  };

  type AppOptions = {
    id: number;
    country?: string;
    lang?: string;
  };

  type SearchResult = {
    id?: number | string;
    trackId?: number | string;
    [key: string]: unknown;
  };

  type AppResult = {
    title?: string;
    subtitle?: string;
    description?: string;
    [key: string]: unknown;
  };

  const store: {
    search: (options: SearchOptions) => Promise<SearchResult[]>;
    app: (options: AppOptions) => Promise<AppResult>;
    device: {
      IPHONE: string;
      [key: string]: string;
    };
  };

  export default store;
}
