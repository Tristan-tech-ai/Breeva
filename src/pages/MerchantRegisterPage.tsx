import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { motion } from 'framer-motion';
import {
  ChevronLeft,
  Store,
  MapPin,
  Phone,
  Globe,
  FileText,
  LocateFixed,
  CheckCircle2,
  Loader2,
} from 'lucide-react';
import { supabase } from '../lib/supabase';
import { useAuthStore } from '../stores/authStore';

const CATEGORIES = [
  'Refill Station',
  'Thrift Store',
  'Vegan',
  'Repair Shop',
  'Eco Products',
  'Café',
  'Market',
  'Books',
  'Other',
];

export default function MerchantRegisterPage() {
  const navigate = useNavigate();
  const { user } = useAuthStore();

  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [category, setCategory] = useState('');
  const [address, setAddress] = useState('');
  const [phone, setPhone] = useState('');
  const [website, setWebsite] = useState('');
  const [coords, setCoords] = useState<{ lat: number; lng: number } | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [isSubmitted, setIsSubmitted] = useState(false);
  const [error, setError] = useState('');

  const handleGetLocation = () => {
    navigator.geolocation.getCurrentPosition(
      (pos) => setCoords({ lat: pos.coords.latitude, lng: pos.coords.longitude }),
      () => setError('Could not get your location'),
      { enableHighAccuracy: true }
    );
  };

  const handleSubmit = async () => {
    if (!name.trim() || !category || !coords) {
      setError('Please fill in name, category, and location.');
      return;
    }
    if (!user) return;

    setIsSubmitting(true);
    setError('');

    const { error: insertErr } = await supabase.from('merchants').insert({
      name: name.trim(),
      description: description.trim() || null,
      category,
      address: address.trim() || null,
      lat: coords.lat,
      lng: coords.lng,
      phone: phone.trim() || null,
      website: website.trim() || null,
      is_verified: false,
      is_active: false, // Admin activates after verification
    });

    setIsSubmitting(false);

    if (insertErr) {
      setError('Failed to submit. Please try again.');
      console.error(insertErr);
    } else {
      setIsSubmitted(true);
    }
  };

  if (isSubmitted) {
    return (
      <div className="gradient-mesh-bg min-h-screen">
        <div className="sticky top-0 z-20 glass-nav px-4 py-3 flex items-center justify-between">
          <button onClick={() => navigate(-1)} className="text-gray-600 dark:text-gray-300 p-1">
            <ChevronLeft className="w-6 h-6" />
          </button>
          <h1 className="text-base font-semibold text-gray-900 dark:text-white">Register Merchant</h1>
          <div className="w-6" />
        </div>
        <div className="px-4 pt-16 max-w-md mx-auto text-center">
          <motion.div initial={{ scale: 0 }} animate={{ scale: 1 }} transition={{ type: 'spring' }}>
            <CheckCircle2 className="w-16 h-16 text-primary-500 mx-auto mb-4" />
          </motion.div>
          <h2 className="text-xl font-bold text-gray-900 dark:text-white mb-2">Submitted!</h2>
          <p className="text-sm text-gray-500 dark:text-gray-400 mb-6">
            Your merchant registration is under review. We'll notify you once it's verified.
          </p>
          <button
            onClick={() => navigate('/merchants')}
            className="gradient-primary text-white py-3 px-8 rounded-xl text-sm font-semibold"
          >
            Back to Merchants
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="gradient-mesh-bg min-h-screen">
      <div className="sticky top-0 z-20 glass-nav px-4 py-3 flex items-center justify-between">
        <button onClick={() => navigate(-1)} className="text-gray-600 dark:text-gray-300 p-1">
          <ChevronLeft className="w-6 h-6" />
        </button>
        <h1 className="text-base font-semibold text-gray-900 dark:text-white">Register Merchant</h1>
        <div className="w-6" />
      </div>

      <div className="px-4 pt-4 pb-12 max-w-md mx-auto space-y-4">
        <p className="text-sm text-gray-500 dark:text-gray-400">
          Register your sustainable business to join Breeva's eco-merchant network and reach eco-conscious customers.
        </p>

        {/* Name */}
        <div>
          <label className="block text-xs font-semibold text-gray-500 dark:text-gray-400 uppercase tracking-wider mb-1.5">
            <Store className="w-3.5 h-3.5 inline mr-1" />Business Name *
          </label>
          <input
            type="text"
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="e.g. Green Refill Station"
            className="glass-input w-full px-4 py-3 text-sm text-gray-900 dark:text-white placeholder-gray-400"
          />
        </div>

        {/* Category */}
        <div>
          <label className="block text-xs font-semibold text-gray-500 dark:text-gray-400 uppercase tracking-wider mb-1.5">
            Category *
          </label>
          <div className="flex flex-wrap gap-2">
            {CATEGORIES.map((cat) => (
              <button
                key={cat}
                onClick={() => setCategory(cat)}
                className={`px-3 py-1.5 rounded-full text-xs font-medium transition-all ${
                  category === cat
                    ? 'gradient-primary text-white shadow-sm'
                    : 'glass-card text-gray-600 dark:text-gray-400'
                }`}
              >
                {cat}
              </button>
            ))}
          </div>
        </div>

        {/* Description */}
        <div>
          <label className="block text-xs font-semibold text-gray-500 dark:text-gray-400 uppercase tracking-wider mb-1.5">
            <FileText className="w-3.5 h-3.5 inline mr-1" />Description
          </label>
          <textarea
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            rows={3}
            placeholder="Tell us about your eco-friendly business..."
            className="glass-input w-full px-4 py-3 text-sm text-gray-900 dark:text-white placeholder-gray-400 resize-none"
          />
        </div>

        {/* Address */}
        <div>
          <label className="block text-xs font-semibold text-gray-500 dark:text-gray-400 uppercase tracking-wider mb-1.5">
            <MapPin className="w-3.5 h-3.5 inline mr-1" />Address
          </label>
          <input
            type="text"
            value={address}
            onChange={(e) => setAddress(e.target.value)}
            placeholder="Full address"
            className="glass-input w-full px-4 py-3 text-sm text-gray-900 dark:text-white placeholder-gray-400"
          />
        </div>

        {/* Location */}
        <div>
          <label className="block text-xs font-semibold text-gray-500 dark:text-gray-400 uppercase tracking-wider mb-1.5">
            Location *
          </label>
          <button
            onClick={handleGetLocation}
            className="glass-card w-full p-3 flex items-center gap-3 text-left"
          >
            <LocateFixed className={`w-5 h-5 ${coords ? 'text-primary-500' : 'text-gray-400'}`} />
            <span className="text-sm text-gray-700 dark:text-gray-300">
              {coords
                ? `${coords.lat.toFixed(5)}, ${coords.lng.toFixed(5)}`
                : 'Tap to get current location'}
            </span>
          </button>
        </div>

        {/* Phone */}
        <div>
          <label className="block text-xs font-semibold text-gray-500 dark:text-gray-400 uppercase tracking-wider mb-1.5">
            <Phone className="w-3.5 h-3.5 inline mr-1" />Phone
          </label>
          <input
            type="tel"
            value={phone}
            onChange={(e) => setPhone(e.target.value)}
            placeholder="+62 8xx xxxx xxxx"
            className="glass-input w-full px-4 py-3 text-sm text-gray-900 dark:text-white placeholder-gray-400"
          />
        </div>

        {/* Website */}
        <div>
          <label className="block text-xs font-semibold text-gray-500 dark:text-gray-400 uppercase tracking-wider mb-1.5">
            <Globe className="w-3.5 h-3.5 inline mr-1" />Website / Instagram
          </label>
          <input
            type="text"
            value={website}
            onChange={(e) => setWebsite(e.target.value)}
            placeholder="https:// or @handle"
            className="glass-input w-full px-4 py-3 text-sm text-gray-900 dark:text-white placeholder-gray-400"
          />
        </div>

        {/* Error */}
        {error && (
          <p className="text-sm text-red-500 text-center">{error}</p>
        )}

        {/* Submit */}
        <button
          onClick={handleSubmit}
          disabled={isSubmitting}
          className="w-full py-3.5 rounded-xl gradient-primary text-white font-semibold text-sm shadow-lg hover:shadow-xl disabled:opacity-50 transition-all"
        >
          {isSubmitting ? (
            <span className="flex items-center justify-center gap-2">
              <Loader2 className="w-4 h-4 animate-spin" /> Submitting...
            </span>
          ) : (
            'Submit Registration'
          )}
        </button>

        <p className="text-[10px] text-gray-400 dark:text-gray-500 text-center">
          Registration is free. Your merchant will be reviewed and activated within 1-3 business days.
        </p>
      </div>
    </div>
  );
}
