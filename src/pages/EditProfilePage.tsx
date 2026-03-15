import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { motion } from 'framer-motion';
import { useAuthStore } from '../stores/authStore';
import { supabase } from '../lib/supabase';

const MAX_AVATAR_SIZE = 2 * 1024 * 1024; // 2MB

export default function EditProfilePage() {
  const { user, profile, updateProfile, isLoading } = useAuthStore();
  const navigate = useNavigate();

  const [name, setName] = useState(profile?.name || '');
  const [avatarPreview, setAvatarPreview] = useState(profile?.avatar_url || '');
  const [avatarFile, setAvatarFile] = useState<File | null>(null);
  const [isSaving, setIsSaving] = useState(false);
  const [message, setMessage] = useState<{ type: 'success' | 'error'; text: string } | null>(null);

  const handleAvatarChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    if (!file.type.startsWith('image/')) {
      setMessage({ type: 'error', text: 'Please select an image file.' });
      return;
    }
    if (file.size > MAX_AVATAR_SIZE) {
      setMessage({ type: 'error', text: 'Image must be under 2MB.' });
      return;
    }

    // Preview
    const reader = new FileReader();
    reader.onload = () => setAvatarPreview(reader.result as string);
    reader.readAsDataURL(file);
    setAvatarFile(file);
  };

  const handleSave = async () => {
    if (!user) return;
    setIsSaving(true);
    setMessage(null);

    try {
      let avatarUrl: string | undefined;

      // Upload avatar if changed
      if (avatarFile) {
        const ext = avatarFile.name.split('.').pop() || 'jpg';
        const filePath = `${user.id}/avatar.${ext}`;

        const { error: uploadErr } = await supabase.storage
          .from('avatars')
          .upload(filePath, avatarFile, { upsert: true, contentType: avatarFile.type });

        if (uploadErr) throw new Error('Avatar upload failed');

        const { data: urlData } = supabase.storage
          .from('avatars')
          .getPublicUrl(filePath);

        avatarUrl = urlData.publicUrl;
      }

      await updateProfile({
        name: name.trim() || null,
        ...(avatarUrl && { avatar_url: avatarUrl }),
      });
      setMessage({ type: 'success', text: 'Profile updated successfully!' });
      setTimeout(() => navigate('/profile'), 1000);
    } catch {
      setMessage({ type: 'error', text: 'Failed to update profile.' });
    } finally {
      setIsSaving(false);
    }
  };

  return (
    <div className="gradient-mesh-bg min-h-screen">
      {/* Header */}
      <div className="sticky top-0 z-20 glass-nav px-4 py-3 flex items-center justify-between">
        <button
          onClick={() => navigate(-1)}
          className="text-gray-600 dark:text-gray-300 p-1"
        >
          <svg className="w-6 h-6" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" />
          </svg>
        </button>
        <h1 className="text-base font-semibold text-gray-900 dark:text-white">Edit Profile</h1>
        <div className="w-6" />
      </div>

      <div className="px-4 pt-6 pb-12 max-w-md mx-auto">
        {/* Avatar Section */}
        <motion.div
          initial={{ opacity: 0, y: 10 }}
          animate={{ opacity: 1, y: 0 }}
          className="flex flex-col items-center mb-8"
        >
          <div className="relative">
            <div className="w-28 h-28 rounded-full border-4 border-white/30 overflow-hidden bg-gray-200 dark:bg-gray-800">
              {avatarPreview ? (
                <img src={avatarPreview} alt="Avatar" className="w-full h-full object-cover" />
              ) : (
                <div className="w-full h-full flex items-center justify-center text-4xl text-gray-400 dark:text-gray-500">
                  {name?.[0]?.toUpperCase() || '?'}
                </div>
              )}
            </div>
            <label className="absolute bottom-0 right-0 w-9 h-9 rounded-full gradient-primary flex items-center justify-center cursor-pointer shadow-lg">
              <svg className="w-4 h-4 text-white" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M3 9a2 2 0 012-2h.93a2 2 0 001.664-.89l.812-1.22A2 2 0 0110.07 4h3.86a2 2 0 011.664.89l.812 1.22A2 2 0 0018.07 7H19a2 2 0 012 2v9a2 2 0 01-2 2H5a2 2 0 01-2-2V9z" />
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 13a3 3 0 11-6 0 3 3 0 016 0z" />
              </svg>
              <input
                type="file"
                accept="image/*"
                onChange={handleAvatarChange}
                className="hidden"
              />
            </label>
          </div>
        </motion.div>

        {/* Form */}
        <motion.div
          initial={{ opacity: 0, y: 10 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.1 }}
          className="space-y-5"
        >
          {/* Display Name */}
          <div>
            <label className="block text-xs font-semibold text-gray-500 dark:text-gray-400 uppercase tracking-wider mb-2">
              Display Name
            </label>
            <input
              type="text"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="Enter your name"
              className="glass-input w-full px-4 py-3 text-sm text-gray-900 dark:text-white placeholder-gray-400"
            />
          </div>

          {/* Email (read-only) */}
          <div>
            <label className="block text-xs font-semibold text-gray-500 dark:text-gray-400 uppercase tracking-wider mb-2">
              Email
            </label>
            <div className="glass-input px-4 py-3 text-sm text-gray-500 dark:text-gray-400 cursor-not-allowed">
              {profile?.email || 'No email'}
            </div>
          </div>

          {/* Username */}
          <div>
            <label className="block text-xs font-semibold text-gray-500 dark:text-gray-400 uppercase tracking-wider mb-2">
              Username
            </label>
            <div className="flex items-center gap-0">
              <span className="glass-input rounded-r-none border-r-0 px-3 py-3 text-sm text-gray-400 dark:text-gray-500">@</span>
              <input
                type="text"
                value={profile?.email?.split('@')[0] || ''}
                disabled
                className="glass-input rounded-l-none flex-1 px-3 py-3 text-sm text-gray-500 dark:text-gray-400 cursor-not-allowed"
              />
            </div>
            <p className="mt-1 text-[10px] text-gray-400 dark:text-gray-500">Username is derived from your email</p>
          </div>

          {/* Status Message */}
          {message && (
            <motion.div
              initial={{ opacity: 0, y: -5 }}
              animate={{ opacity: 1, y: 0 }}
              className={`p-3 rounded-xl text-sm text-center ${
                message.type === 'success'
                  ? 'bg-primary-50 dark:bg-primary-900/20 text-primary-600 dark:text-primary-400 border border-primary-200 dark:border-primary-800'
                  : 'bg-red-50 dark:bg-red-900/20 text-red-600 dark:text-red-400 border border-red-200 dark:border-red-800'
              }`}
            >
              {message.text}
            </motion.div>
          )}

          {/* Save Button */}
          <button
            onClick={handleSave}
            disabled={isSaving || isLoading}
            className="w-full py-3.5 rounded-xl gradient-primary text-white font-semibold text-sm shadow-lg hover:shadow-xl hover:scale-[1.02] active:scale-[0.98] disabled:opacity-50 disabled:cursor-not-allowed transition-all duration-200"
          >
            {isSaving ? (
              <div className="flex items-center justify-center gap-2">
                <div className="w-4 h-4 border-2 border-white border-t-transparent rounded-full animate-spin" />
                Saving...
              </div>
            ) : (
              'Save Changes'
            )}
          </button>
        </motion.div>
      </div>
    </div>
  );
}
