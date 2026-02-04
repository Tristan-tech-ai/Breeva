import type { VercelRequest, VercelResponse } from '@vercel/node';

export default function handler(req: VercelRequest, res: VercelResponse) {
  const { code, error, error_description } = req.query;

  if (error) {
    console.error('Auth error:', error, error_description);
    return res.redirect(`/?error=${encodeURIComponent(error as string)}`);
  }

  if (!code) {
    return res.redirect('/?error=no_code');
  }

  // Redirect to frontend with the auth code
  // The frontend will handle the token exchange via Supabase client
  return res.redirect(`/auth/callback?code=${code}`);
}
