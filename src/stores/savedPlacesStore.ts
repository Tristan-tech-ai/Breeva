import { create } from 'zustand';
import type { SavedPlace, Coordinate } from '../types';
import { supabase } from '../lib/supabase';

interface SavedPlacesState {
  places: SavedPlace[];
  loadPlaces: () => void;
  fetchCloudPlaces: (userId: string) => Promise<void>;
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

  fetchCloudPlaces: async (userId: string) => {
    const { data } = await supabase
      .from('saved_places')
      .select('*')
      .eq('user_id', userId)
      .order('created_at', { ascending: false });

    if (data && data.length > 0) {
      const places: SavedPlace[] = data.map((r) => ({
        id: r.id,
        name: r.name,
        address: r.address || undefined,
        coordinate: { lat: r.latitude, lng: r.longitude },
        category: r.category || 'favorite',
        createdAt: r.created_at,
      }));
      set({ places });
      saveToStorage(places);
    } else {
      // If cloud is empty but local has data, sync local → cloud
      const local = loadFromStorage();
      if (local.length > 0) {
        const rows = local.map((p) => ({
          id: p.id,
          user_id: userId,
          name: p.name,
          address: p.address || null,
          latitude: p.coordinate.lat,
          longitude: p.coordinate.lng,
          category: p.category || 'favorite',
          created_at: p.createdAt,
        }));
        await supabase.from('saved_places').upsert(rows, { onConflict: 'id' });
      }
    }
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

    // Sync to cloud (non-blocking)
    supabase.auth.getUser().then(({ data: { user } }) => {
      if (user) {
        supabase.from('saved_places').insert({
          id: place.id,
          user_id: user.id,
          name: place.name,
          address: place.address || null,
          latitude: place.coordinate.lat,
          longitude: place.coordinate.lng,
          category: place.category,
        }).then(() => {});
      }
    });
  },

  removePlace: (id) => {
    const updated = get().places.filter(p => p.id !== id);
    set({ places: updated });
    saveToStorage(updated);

    // Sync to cloud (non-blocking)
    supabase.from('saved_places').delete().eq('id', id).then(() => {});
  },

  updatePlace: (id, updates) => {
    const updated = get().places.map(p =>
      p.id === id ? { ...p, ...updates } : p
    );
    set({ places: updated });
    saveToStorage(updated);

    // Sync to cloud (non-blocking)
    const place = updated.find(p => p.id === id);
    if (place) {
      supabase.from('saved_places').update({
        name: place.name,
        address: place.address || null,
        latitude: place.coordinate.lat,
        longitude: place.coordinate.lng,
        category: place.category,
      }).eq('id', id).then(() => {});
    }
  },

  isPlaceSaved: (coordinate) => {
    return get().places.some(p =>
      Math.abs(p.coordinate.lat - coordinate.lat) < 0.0005 &&
      Math.abs(p.coordinate.lng - coordinate.lng) < 0.0005
    );
  },
}));
