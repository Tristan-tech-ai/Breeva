import { useEffect } from 'react';
import { useMap } from 'react-leaflet';
import { lipatAtribusi } from '../../lib/map/lipatAtribusi';

/** M-U09: the attribution of a small in-app map folds to the (i) button like the main maps (OSMF 1.5.2). */
export default function LipatAtribusi() {
  const map = useMap();
  useEffect(() => lipatAtribusi(map), [map]);
  return null;
}
