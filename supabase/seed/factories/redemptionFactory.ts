import { randomFrom, randomTimestamp, generateQrCode, generateBackupCode } from '../utils/helpers';

export interface RedemptionSeedData {
  user_id: string;
  reward_id: string;
  merchant_id: string;
  points_spent: number;
  qr_code: string;
  backup_code: string;
  status: string;
  used_at: string | null;
  expires_at: string;
  created_at: string;
}

export function makeRedemption(
  userId: string,
  rewardId: string,
  merchantId: string,
  pointsCost: number,
): RedemptionSeedData {
  const status = randomFrom(['active', 'active', 'used', 'used', 'expired']);
  const created = randomTimestamp(-14, 0);

  return {
    user_id: userId,
    reward_id: rewardId,
    merchant_id: merchantId,
    points_spent: pointsCost,
    qr_code: generateQrCode(),
    backup_code: generateBackupCode(),
    status,
    used_at: status === 'used' ? randomTimestamp(-7, 0) : null,
    expires_at: status === 'expired' ? randomTimestamp(-14, -1) : randomTimestamp(1, 14),
    created_at: created,
  };
}
