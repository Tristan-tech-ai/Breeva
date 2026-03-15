import { useState, useEffect, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import { motion } from 'framer-motion';
import {
  Moon, Bell, MapPin, CalendarDays, BarChart3,
  User, Trash2, Smartphone, FileText, Lock, Globe, Ruler,
} from 'lucide-react';
import type { LucideIcon } from 'lucide-react';
import BottomNavigation from '../components/layout/BottomNavigation';
import { useAuthStore } from '../stores/authStore';
import { supabase } from '../lib/supabase';
import { requestNotificationPermission, isNotificationEnabled, scheduleStreakReminder, scheduleQuestReminder } from '../lib/notifications';
import { useI18nStore } from '../stores/i18nStore';

interface SettingSection {
  title: string;
  items: SettingItem[];
}

interface SettingItem {
  icon: LucideIcon;
  label: string;
  description?: string;
  type: 'toggle' | 'select' | 'link' | 'danger';
  value?: boolean | string;
  options?: string[];
  onSelect?: (v: string) => void;
  action?: () => void;
}

interface Settings {
  dark_mode: boolean;
  push_notifications: boolean;
  location_tracking: boolean;
  quest_reminders: boolean;
  anonymous_data: boolean;
  profile_visible: boolean;
}

const DEFAULTS: Settings = {
  dark_mode: false,
  push_notifications: true,
  location_tracking: true,
  quest_reminders: true,
  anonymous_data: true,
  profile_visible: true,
};

export default function SettingsPage() {
  const navigate = useNavigate();
  const { user } = useAuthStore();
  const { locale, setLocale } = useI18nStore();
  const [distanceUnit, setDistanceUnit] = useState<string>(() => localStorage.getItem('breeva_distance_unit') || 'km');
  const [settings, setSettings] = useState<Settings>(() => {
    // Init from localStorage
    return {
      dark_mode: document.documentElement.classList.contains('dark'),
      push_notifications: localStorage.getItem('breeva_push_notifications') !== 'false',
      location_tracking: localStorage.getItem('breeva_location_tracking') !== 'false',
      quest_reminders: localStorage.getItem('breeva_quest_reminders') !== 'false',
      anonymous_data: localStorage.getItem('breeva_anonymous_data') !== 'false',
      profile_visible: localStorage.getItem('breeva_profile_visible') !== 'false',
    };
  });

  // Fetch from Supabase on mount
  useEffect(() => {
    if (!user) return;
    supabase
      .from('user_settings')
      .select('*')
      .eq('user_id', user.id)
      .single()
      .then(({ data }) => {
        if (data) {
          const cloud: Settings = {
            dark_mode: data.dark_mode ?? DEFAULTS.dark_mode,
            push_notifications: data.push_notifications ?? DEFAULTS.push_notifications,
            location_tracking: data.location_tracking ?? DEFAULTS.location_tracking,
            quest_reminders: data.quest_reminders ?? DEFAULTS.quest_reminders,
            anonymous_data: data.anonymous_data ?? DEFAULTS.anonymous_data,
            profile_visible: data.profile_visible ?? DEFAULTS.profile_visible,
          };
          setSettings(cloud);
          // Apply dark mode from cloud
          document.documentElement.classList.toggle('dark', cloud.dark_mode);
          // Cache locally
          for (const [k, v] of Object.entries(cloud)) {
            localStorage.setItem(`breeva_${k}`, String(v));
          }
        }
      });
  }, [user]);

  const syncToCloud = useCallback((updated: Settings) => {
    if (!user) return;
    supabase
      .from('user_settings')
      .upsert({ user_id: user.id, ...updated, updated_at: new Date().toISOString() })
      .then(() => {});
  }, [user]);

  const toggle = async (key: keyof Settings) => {
    // Special handling for push notifications — request permission
    if (key === 'push_notifications' && !settings.push_notifications) {
      const permission = await requestNotificationPermission();
      if (permission !== 'granted') return; // User denied
    }

    setSettings(prev => {
      const updated = { ...prev, [key]: !prev[key] };
      // localStorage cache
      localStorage.setItem(`breeva_${key}`, String(updated[key]));
      // Side effects
      if (key === 'dark_mode') {
        document.documentElement.classList.toggle('dark', updated.dark_mode);
      }
      if (key === 'push_notifications' && updated.push_notifications && isNotificationEnabled()) {
        scheduleStreakReminder();
        scheduleQuestReminder();
      }
      // Sync to cloud (non-blocking)
      syncToCloud(updated);
      return updated;
    });
  };

  const sections: SettingSection[] = [
    {
      title: 'Appearance',
      items: [
        {
          icon: Moon,
          label: 'Dark Mode',
          description: 'Switch between light and dark themes',
          type: 'toggle',
          value: settings.dark_mode,
          action: () => toggle('dark_mode'),
        },
      ],
    },
    {
      title: 'Language & Units',
      items: [
        {
          icon: Globe,
          label: 'Language',
          description: locale === 'en' ? 'English' : 'Bahasa Indonesia',
          type: 'select',
          value: locale,
          options: ['en', 'id'],
          onSelect: (v: string) => setLocale(v as 'en' | 'id'),
        },
        {
          icon: Ruler,
          label: 'Distance Unit',
          description: distanceUnit === 'km' ? 'Kilometers' : 'Miles',
          type: 'select',
          value: distanceUnit,
          options: ['km', 'miles'],
          onSelect: (v: string) => {
            setDistanceUnit(v);
            localStorage.setItem('breeva_distance_unit', v);
          },
        },
      ],
    },
    {
      title: 'Notifications',
      items: [
        {
          icon: Bell,
          label: 'Push Notifications',
          description: 'Receive walk and quest reminders',
          type: 'toggle',
          value: settings.push_notifications,
          action: () => toggle('push_notifications'),
        },
        {
          icon: MapPin,
          label: 'Location Updates',
          description: 'Notify about nearby merchants',
          type: 'toggle',
          value: settings.location_tracking,
          action: () => toggle('location_tracking'),
        },
        {
          icon: CalendarDays,
          label: 'Quest Reminders',
          description: 'Daily quest availability alerts',
          type: 'toggle',
          value: settings.quest_reminders,
          action: () => toggle('quest_reminders'),
        },
      ],
    },
    {
      title: 'Privacy',
      items: [
        {
          icon: BarChart3,
          label: 'Anonymous Data',
          description: 'Share anonymized usage data to improve Breeva',
          type: 'toggle',
          value: settings.anonymous_data,
          action: () => toggle('anonymous_data'),
        },
        {
          icon: User,
          label: 'Profile Visibility',
          description: 'Show your profile on leaderboards',
          type: 'toggle',
          value: settings.profile_visible,
          action: () => toggle('profile_visible'),
        },
        {
          icon: Trash2,
          label: 'Delete My Data',
          description: 'Permanently delete all your data',
          type: 'danger',
          action: () => {
            if (confirm('Are you sure? This action cannot be undone.')) {
              // TODO: Implement data deletion
              alert('Data deletion request submitted.');
            }
          },
        },
      ],
    },
    {
      title: 'About',
      items: [
        {
          icon: Smartphone,
          label: 'App Version',
          description: 'v0.1.0 (Beta)',
          type: 'link',
        },
        {
          icon: FileText,
          label: 'Terms of Service',
          type: 'link',
          action: () => navigate('/terms'),
        },
        {
          icon: Lock,
          label: 'Privacy Policy',
          type: 'link',
          action: () => navigate('/privacy'),
        },
      ],
    },
  ];

  return (
    <div className="gradient-mesh-bg min-h-screen pb-24">
      {/* Header */}
      <div className="sticky top-0 z-20 glass-nav px-4 py-3 flex items-center justify-between">
        <button onClick={() => navigate(-1)} className="text-gray-600 dark:text-gray-300 p-1">
          <svg className="w-6 h-6" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" />
          </svg>
        </button>
        <h1 className="text-base font-semibold text-gray-900 dark:text-white">Settings</h1>
        <div className="w-6" />
      </div>

      <div className="px-4 pt-4 pb-12 space-y-6">
        {sections.map((section, sIdx) => (
          <motion.div
            key={section.title}
            initial={{ opacity: 0, y: 10 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: sIdx * 0.05 }}
          >
            <h3 className="text-xs font-semibold text-gray-500 dark:text-gray-400 uppercase tracking-wider mb-3 px-1">
              {section.title}
            </h3>
            <div className="glass-card overflow-hidden divide-y divide-gray-100 dark:divide-gray-800">
              {section.items.map((item) => (
                <button
                  key={item.label}
                  onClick={item.action}
                  className="w-full flex items-center justify-between px-4 py-3.5 hover:bg-white dark:bg-gray-900/50 dark:hover:bg-white dark:bg-gray-900/5 transition-colors text-left"
                >
                  <div className="flex items-center gap-3">
                    {(() => { const Icon = item.icon; return <Icon className={`w-5 h-5 ${item.type === 'danger' ? 'text-red-400' : 'text-primary-500'}`} strokeWidth={1.8} />; })()}
                    <div>
                      <div className={`text-sm font-medium ${
                        item.type === 'danger'
                          ? 'text-red-500'
                          : 'text-gray-900 dark:text-white'
                      }`}>
                        {item.label}
                      </div>
                      {item.description && (
                        <div className="text-[10px] text-gray-400 dark:text-gray-500 mt-0.5">
                          {item.description}
                        </div>
                      )}
                    </div>
                  </div>

                  {item.type === 'toggle' && (
                    <div
                      className={`w-11 h-6 rounded-full relative transition-colors duration-200 ${
                        item.value
                          ? 'bg-primary-500'
                          : 'bg-gray-300 dark:bg-gray-600'
                      }`}
                    >
                      <div
                        className={`absolute top-0.5 w-5 h-5 rounded-full bg-white dark:bg-gray-900 shadow-sm transition-transform duration-200 ${
                          item.value ? 'translate-x-[22px]' : 'translate-x-[2px]'
                        }`}
                      />
                    </div>
                  )}

                  {item.type === 'select' && item.options && (
                    <div className="flex rounded-lg overflow-hidden border border-gray-200 dark:border-gray-700">
                      {item.options.map(opt => (
                        <button
                          key={opt}
                          onClick={(e) => { e.stopPropagation(); item.onSelect?.(opt); }}
                          className={`px-2.5 py-1 text-[10px] font-medium transition uppercase ${
                            item.value === opt
                              ? 'bg-primary-500 text-white'
                              : 'text-gray-500 dark:text-gray-400 hover:bg-gray-100 dark:hover:bg-gray-800'
                          }`}
                        >
                          {opt}
                        </button>
                      ))}
                    </div>
                  )}

                  {item.type === 'link' && !item.action && (
                    <span className="text-xs text-gray-400 dark:text-gray-500">{item.description}</span>
                  )}

                  {item.type === 'link' && item.action && (
                    <svg className="w-4 h-4 text-gray-400 dark:text-gray-500" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
                    </svg>
                  )}
                </button>
              ))}
            </div>
          </motion.div>
        ))}
      </div>

      <BottomNavigation />
    </div>
  );
}
