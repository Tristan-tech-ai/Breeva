declare module 'idb' {
  export interface DBSchema {
    [store: string]: {
      key: unknown;
      value: unknown;
      indexes?: Record<string, unknown>;
    };
  }

  export interface IDBPObjectStore {
    clear(): Promise<void>;
    put(value: unknown): Promise<unknown>;
    createIndex(name: string, keyPath: string): void;
  }

  export interface IDBPTransaction {
    store: IDBPObjectStore;
    done: Promise<void>;
  }

  export interface IDBPDatabase<TSchema extends DBSchema = DBSchema> {
    objectStoreNames: { contains(name: string): boolean };
    createObjectStore(name: keyof TSchema | string, options?: { keyPath?: string; autoIncrement?: boolean }): IDBPObjectStore;
    transaction(storeNames: keyof TSchema | string, mode?: 'readonly' | 'readwrite'): IDBPTransaction;
    getAll(storeName: keyof TSchema | string): Promise<unknown[]>;
    getAllFromIndex(storeName: keyof TSchema | string, indexName: string, query?: unknown): Promise<unknown[]>;
    get(storeName: keyof TSchema | string, key: unknown): Promise<any>;
    put(storeName: keyof TSchema | string, value: unknown): Promise<unknown>;
    add(storeName: keyof TSchema | string, value: unknown): Promise<any>;
    delete(storeName: keyof TSchema | string, key: unknown): Promise<void>;
  }

  export function openDB<TSchema extends DBSchema = DBSchema>(
    name: string,
    version: number,
    options?: {
      upgrade?(db: IDBPDatabase<TSchema>): void;
    },
  ): Promise<IDBPDatabase<TSchema>>;
}
