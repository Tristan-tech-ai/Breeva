import { create } from 'zustand';
import type { SavedPlace, Coordinate } from '../types';

interface SavedPlacesState {
  places: SavedPlace[];
  loadPlaces: () => void;
  addPlace: (name: string, coordinate: Coordinate, category?: SavedPlace['category'], address?: string) => void;
  removePlace: (id: string) => void;
  updatePlace: (id: string, updates: Partial<SavedPlace>) => void;
  isPlaceSaved: (coordinate: Coordinate) => boolean;
}

const STORAGE_KEY = 'breeva_saved_places';

const loadFromStorage = (): SavedPlace[] => {
  try {
    const stored = localStorage.getItem(STORAGE_KEY);
    return stored ? JSON.parse(stored) : [];
  } catch {
    return [];
  }
};

const saveToStorage = (places: SavedPlace[]) => {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(places));
  } catch {
    // Storage full or unavailable
  }
};

export const useSavedPlacesStore = create<SavedPlacesState>()((set, get) => ({
  places: loadFromStorage(),

  loadPlaces: () => {
    set({ places: loadFromStorage() });
  },

  addPlace: (name, coordinate, category = 'favorite', address) => {
    const place: SavedPlace = {
      id: crypto.randomUUID(),
      name,
      address,
      coordinate,
      category,
      createdAt: new Date().toISOString(),
    };
    const updated = [place, ...get().places];
    set({ places: updated });
    saveToStorage(updated);
  },

  removePlace: (id) => {
    const updated = get().places.filter(p => p.id !== id);
    set({ places: updated });
    saveToStorage(updated);
  },

  updatePlace: (id, updates) => {
    const updated = get().places.map(p =>
      p.id === id ? { ...p, ...updates } : p
    );
    set({ places: updated });
    saveToStorage(updated);
  },

  isPlaceSaved: (coordinate) => {
    return get().places.some(p =>
      Math.abs(p.coordinate.lat - coordinate.lat) < 0.0005 &&
      Math.abs(p.coordinate.lng - coordinate.lng) < 0.0005
    );
  },
}));
