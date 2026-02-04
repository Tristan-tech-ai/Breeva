import type { VercelRequest, VercelResponse } from '@vercel/node';
import { createClient } from '@supabase/supabase-js';

const supabase = createClient(
  process.env.VITE_SUPABASE_URL || '',
  process.env.SUPABASE_SERVICE_ROLE_KEY || ''
);

interface VerifyRewardRequest {
  qr_code: string;
  merchant_id: string;
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  try {
    const { qr_code, merchant_id }: VerifyRewardRequest = req.body;

    if (!qr_code || !merchant_id) {
      return res.status(400).json({ error: 'QR code and merchant ID required' });
    }

    // Find the redeemed reward
    const { data: redemption, error } = await supabase
      .from('redeemed_rewards')
      .select(`
        *,
        reward:rewards(*),
        user:users(full_name, email)
      `)
      .eq('qr_code', qr_code)
      .eq('merchant_id', merchant_id)
      .single();

    if (error || !redemption) {
      return res.status(404).json({ 
        valid: false, 
        error: 'Reward not found or does not belong to this merchant' 
      });
    }

    // Check status
    if (redemption.status === 'used') {
      return res.status(400).json({
        valid: false,
        error: 'Reward has already been used',
        used_at: redemption.used_at,
      });
    }

    if (redemption.status === 'expired' || new Date(redemption.expires_at) < new Date()) {
      return res.status(400).json({
        valid: false,
        error: 'Reward has expired',
        expired_at: redemption.expires_at,
      });
    }

    // Mark as used
    const { error: updateError } = await supabase
      .from('redeemed_rewards')
      .update({ 
        status: 'used', 
        used_at: new Date().toISOString() 
      })
      .eq('id', redemption.id);

    if (updateError) {
      console.error('Failed to update redemption:', updateError);
      return res.status(500).json({ error: 'Failed to verify reward' });
    }

    return res.status(200).json({
      valid: true,
      reward: {
        title: redemption.reward.title,
        description: redemption.reward.description,
        discount_percentage: redemption.reward.discount_percentage,
        discount_amount: redemption.reward.discount_amount,
      },
      user: {
        name: redemption.user.full_name,
      },
      verified_at: new Date().toISOString(),
    });
  } catch (error) {
    console.error('Verify reward error:', error);
    return res.status(500).json({ error: 'Internal server error' });
  }
}
