import { useNavigate } from 'react-router-dom';
import { ChevronLeft } from 'lucide-react';

export default function PrivacyPage() {
  const navigate = useNavigate();

  return (
    <div className="gradient-mesh-bg min-h-screen pb-12">
      {/* Header */}
      <div className="sticky top-0 z-20 glass-nav px-4 py-3 flex items-center justify-between safe-area-top">
        <button onClick={() => navigate(-1)} className="text-gray-600 dark:text-gray-300 p-1">
          <ChevronLeft className="w-6 h-6" />
        </button>
        <h1 className="text-base font-semibold text-gray-900 dark:text-white">Privacy Policy</h1>
        <div className="w-6" />
      </div>

      <div className="max-w-2xl mx-auto px-5 pt-6 space-y-6">
        <p className="text-xs text-gray-400 dark:text-gray-500">Last updated: June 2025</p>

        <Section title="1. Introduction">
          Breeva ("we", "our", "us") respects your privacy. This Privacy Policy describes how we collect, use,
          store, and protect your information when you use our eco-walking navigation app.
        </Section>

        <Section title="2. Information We Collect">
          <h3 className="text-xs font-semibold text-gray-700 dark:text-gray-300 mt-2 mb-1">a) Account Information</h3>
          <p>When you sign in with Google, we receive your name, email address, and profile photo. This is used to create and manage your Breeva account.</p>

          <h3 className="text-xs font-semibold text-gray-700 dark:text-gray-300 mt-3 mb-1">b) Location Data</h3>
          <p>We access your device location to provide navigation, route tracking, and air quality information. Location is used in real-time and stored as walk history in your account.</p>

          <h3 className="text-xs font-semibold text-gray-700 dark:text-gray-300 mt-3 mb-1">c) Walk & Activity Data</h3>
          <p>Distance, duration, route coordinates, transport mode, and EcoPoints earned are stored to provide your eco-impact dashboard, walk history, and achievements.</p>

          <h3 className="text-xs font-semibold text-gray-700 dark:text-gray-300 mt-3 mb-1">d) User-Generated Content</h3>
          <p>Reports submitted via the Contribute feature (e.g., hazard reports, missing places) are stored and may include location and descriptive text.</p>
        </Section>

        <Section title="3. How We Use Your Data">
          <ul className="list-disc list-inside space-y-1.5 mt-1">
            <li>Provide and improve navigation and eco-route suggestions.</li>
            <li>Display real-time air quality along your routes.</li>
            <li>Calculate and track your environmental impact (CO₂ saved, trees equivalent).</li>
            <li>Award and manage EcoPoints and achievements.</li>
            <li>Enable reward redemption at eco-merchant partners.</li>
            <li>Improve app reliability and user experience through anonymized analytics.</li>
          </ul>
        </Section>

        <Section title="4. Data Storage & Security">
          <ul className="list-disc list-inside space-y-1.5 mt-1">
            <li>Data is stored in Supabase (PostgreSQL) with Row Level Security (RLS) ensuring you can only access your own data.</li>
            <li>All communication between the app and servers uses HTTPS encryption.</li>
            <li>Authentication is handled via Supabase Auth with Google OAuth 2.0.</li>
            <li>We do not store your Google password — authentication tokens are managed securely by the platform.</li>
          </ul>
        </Section>

        <Section title="5. Data Sharing">
          We do <strong>not</strong> sell, rent, or share your personal data with third parties for advertising purposes.
          <ul className="list-disc list-inside space-y-1.5 mt-2">
            <li><strong>Merchant Partners:</strong> When you redeem a reward, the merchant receives only the voucher code and redemption status — not your personal data.</li>
            <li><strong>API Providers:</strong> Route requests are sent to OpenRouteService; air quality queries to Open-Meteo. These requests include coordinates but not personal identifiers.</li>
            <li><strong>Leaderboard:</strong> If you opt into the weekly leaderboard, your display name and score are visible to other users.</li>
          </ul>
        </Section>

        <Section title="6. Your Rights">
          <ul className="list-disc list-inside space-y-1.5 mt-1">
            <li><strong>Access:</strong> View all your stored data through Profile, Walk History, and Eco Impact pages.</li>
            <li><strong>Correction:</strong> Edit your profile information anytime via Edit Profile.</li>
            <li><strong>Deletion:</strong> Delete all your data via Settings → Privacy → "Delete My Data". This action is permanent and irreversible.</li>
            <li><strong>Portability:</strong> Contact us to request a copy of your data in a machine-readable format.</li>
          </ul>
        </Section>

        <Section title="7. Cookies & Local Storage">
          Breeva uses browser local storage to persist your preferences (e.g., dark mode, settings) and authentication session. We do not use third-party tracking cookies.
        </Section>

        <Section title="8. Children's Privacy">
          Breeva is not directed at children under 13. We do not knowingly collect information from children. If we learn a child has provided us with personal data, we will promptly delete it.
        </Section>

        <Section title="9. Changes to This Policy">
          We may update this Privacy Policy periodically. Changes will be reflected in the "Last updated" date. Continued use of Breeva after changes constitutes acceptance.
        </Section>

        <Section title="10. Contact Us">
          If you have questions about this Privacy Policy or wish to exercise your data rights, contact us at{' '}
          <a href="mailto:privacy@breeva.app" className="text-primary-500 underline">privacy@breeva.app</a>.
        </Section>

        <div className="pt-2 pb-8">
          <div className="h-px bg-gray-200 dark:bg-gray-700/40" />
          <p className="text-[10px] text-gray-400 dark:text-gray-500 mt-3 text-center">
            © 2025 Breeva. All rights reserved.
          </p>
        </div>
      </div>
    </div>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div>
      <h2 className="text-sm font-semibold text-gray-900 dark:text-white mb-2">{title}</h2>
      <div className="text-sm text-gray-600 dark:text-gray-400 leading-relaxed">{children}</div>
    </div>
  );
}
