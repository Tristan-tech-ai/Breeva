import { useNavigate } from 'react-router-dom';
import { ChevronLeft } from 'lucide-react';

export default function TermsPage() {
  const navigate = useNavigate();

  return (
    <div className="gradient-mesh-bg min-h-screen pb-12">
      {/* Header */}
      <div className="sticky top-0 z-20 glass-nav px-4 py-3 flex items-center justify-between safe-area-top">
        <button onClick={() => navigate(-1)} className="text-gray-600 dark:text-gray-300 p-1">
          <ChevronLeft className="w-6 h-6" />
        </button>
        <h1 className="text-base font-semibold text-gray-900 dark:text-white">Terms of Service</h1>
        <div className="w-6" />
      </div>

      <div className="max-w-2xl mx-auto px-5 pt-6 space-y-6">
        <p className="text-xs text-gray-400">Last updated: June 2025</p>

        <Section title="1. Acceptance of Terms">
          By downloading, installing, or using the Breeva application ("Service"), you agree to be bound by
          these Terms of Service. If you do not agree, please do not use the Service.
        </Section>

        <Section title="2. Description of Service">
          Breeva is an eco-friendly walking and navigation application that provides route suggestions
          optimized for air quality, awards EcoPoints for sustainable transportation choices, and connects
          users with eco-conscious merchants. The app uses real-time air quality data, mapping services, and
          location-based features to deliver its core functionality.
        </Section>

        <Section title="3. User Accounts">
          <ul className="list-disc list-inside space-y-1.5 mt-1">
            <li>You must create an account using Google Sign-In to access personalized features.</li>
            <li>You are responsible for maintaining the security of your account credentials.</li>
            <li>You agree to provide accurate, current, and complete information.</li>
            <li>One account per person. Duplicate or shared accounts may be terminated.</li>
          </ul>
        </Section>

        <Section title="4. EcoPoints">
          <ul className="list-disc list-inside space-y-1.5 mt-1">
            <li>EcoPoints are virtual, non-transferable rewards with no cash value.</li>
            <li>Points are earned by completing verified walks and eco-friendly activities.</li>
            <li>Breeva reserves the right to modify point earning rates, expiration policies, and redemption values at any time.</li>
            <li>Any attempt to abuse or manipulate the point system (e.g., GPS spoofing, automated walks) will result in account termination and forfeiture of all points.</li>
          </ul>
        </Section>

        <Section title="5. Location Data & Privacy">
          <ul className="list-disc list-inside space-y-1.5 mt-1">
            <li>Breeva requires location access to provide navigation and route tracking.</li>
            <li>Location data is processed locally and is not shared with third parties for advertising purposes.</li>
            <li>Walk data is stored securely in your account for calculating eco-impact metrics.</li>
            <li>Please refer to our <button onClick={() => navigate('/privacy')} className="text-primary-500 underline">Privacy Policy</button> for full details.</li>
          </ul>
        </Section>

        <Section title="6. Acceptable Use">
          You agree not to:
          <ul className="list-disc list-inside space-y-1.5 mt-2">
            <li>Use the Service for any unlawful purpose.</li>
            <li>Interfere with or disrupt the Service or its servers.</li>
            <li>Attempt to gain unauthorized access to other users' accounts.</li>
            <li>Submit false or misleading reports, ratings, or content.</li>
            <li>Use automated tools to interact with the Service.</li>
          </ul>
        </Section>

        <Section title="7. Merchant Partners">
          Breeva connects you with third-party eco-merchants. We do not control and are not liable for the
          products, services, or practices of these merchants. Redemption terms are set by each merchant and
          may vary.
        </Section>

        <Section title="8. Disclaimer of Warranties">
          Route suggestions and air quality data are provided "as-is" for informational purposes only. Breeva
          does not guarantee the accuracy, completeness, or reliability of route information, AQI readings, or
          estimated eco-impact calculations. Always use personal judgment and follow traffic laws.
        </Section>

        <Section title="9. Limitation of Liability">
          To the maximum extent permitted by law, Breeva shall not be liable for any indirect, incidental,
          special, or consequential damages arising from your use of the Service, including but not limited to
          injury, property damage, or data loss.
        </Section>

        <Section title="10. Modifications">
          We may update these Terms from time to time. Continued use after changes constitutes acceptance of
          the revised Terms. Major changes will be notified via the app.
        </Section>

        <Section title="11. Termination">
          We reserve the right to suspend or terminate your account for violation of these Terms. You may
          delete your account at any time through Settings &gt; Privacy &gt; Delete My Data.
        </Section>

        <Section title="12. Contact">
          For questions about these Terms, contact us at{' '}
          <a href="mailto:legal@breeva.app" className="text-primary-500 underline">legal@breeva.app</a>.
        </Section>

        <div className="pt-2 pb-8">
          <div className="h-px bg-gray-200/40 dark:bg-gray-700/40" />
          <p className="text-[10px] text-gray-400 mt-3 text-center">
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
