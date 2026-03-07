import { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { motion } from 'framer-motion';
import {
  Moon, Bell, MapPin, CalendarDays, BarChart3,
  User, Trash2, Smartphone, FileText, Lock,
} from 'lucide-react';
import type { LucideIcon } from 'lucide-react';
import BottomNavigation from '../components/layout/BottomNavigation';

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
  action?: () => void;
}

export default function SettingsPage() {
  const navigate = useNavigate();
  const [darkMode, setDarkMode] = useState(
    document.documentElement.classList.contains('dark')
  );
  const [pushNotifications, setPushNotifications] = useState(() => localStorage.getItem('breeva_push_notifications') !== 'false');
  const [locationTracking, setLocationTracking] = useState(() => localStorage.getItem('breeva_location_tracking') !== 'false');
  const [questReminders, setQuestReminders] = useState(() => localStorage.getItem('breeva_quest_reminders') !== 'false');
  const [anonymousData, setAnonymousData] = useState(() => localStorage.getItem('breeva_anonymous_data') !== 'false');
  const [profileVisible, setProfileVisible] = useState(() => localStorage.getItem('breeva_profile_visible') !== 'false');

  // Persist toggles to localStorage
  useEffect(() => {
    localStorage.setItem('breeva_push_notifications', String(pushNotifications));
  }, [pushNotifications]);
  useEffect(() => {
    localStorage.setItem('breeva_location_tracking', String(locationTracking));
  }, [locationTracking]);
  useEffect(() => {
    localStorage.setItem('breeva_quest_reminders', String(questReminders));
  }, [questReminders]);
  useEffect(() => {
    localStorage.setItem('breeva_anonymous_data', String(anonymousData));
  }, [anonymousData]);
  useEffect(() => {
    localStorage.setItem('breeva_profile_visible', String(profileVisible));
  }, [profileVisible]);

  const toggleDarkMode = () => {
    const newVal = !darkMode;
    setDarkMode(newVal);
    document.documentElement.classList.toggle('dark', newVal);
    localStorage.setItem('breeva_dark_mode', newVal ? 'true' : 'false');
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
          value: darkMode,
          action: toggleDarkMode,
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
          value: pushNotifications,
          action: () => setPushNotifications(!pushNotifications),
        },
        {
          icon: MapPin,
          label: 'Location Updates',
          description: 'Notify about nearby merchants',
          type: 'toggle',
          value: locationTracking,
          action: () => setLocationTracking(!locationTracking),
        },
        {
          icon: CalendarDays,
          label: 'Quest Reminders',
          description: 'Daily quest availability alerts',
          type: 'toggle',
          value: questReminders,
          action: () => setQuestReminders(!questReminders),
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
          value: anonymousData,
          action: () => setAnonymousData(!anonymousData),
        },
        {
          icon: User,
          label: 'Profile Visibility',
          description: 'Show your profile on leaderboards',
          type: 'toggle',
          value: profileVisible,
          action: () => setProfileVisible(!profileVisible),
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
