import { supabase } from '@/shared/lib/supabase';

const STRAVA_CLIENT_ID = process.env.NEXT_PUBLIC_STRAVA_CLIENT_ID;
const STRAVA_CLIENT_SECRET = process.env.STRAVA_CLIENT_SECRET;

/**
 * Trao đổi Authorization Code lấy Token từ Strava
 */
export async function exchangeStravaToken(code: string, userId: string) {
  if (!STRAVA_CLIENT_ID || !STRAVA_CLIENT_SECRET) {
    throw new Error('Thiếu cấu hình Strava Client ID hoặc Secret');
  }

  const response = await fetch('https://www.strava.com/oauth/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      client_id: STRAVA_CLIENT_ID,
      client_secret: STRAVA_CLIENT_SECRET,
      code: code,
      grant_type: 'authorization_code',
    }),
  });

  const data = await response.json();
  if (!response.ok) throw new Error(data.message || 'Lỗi xác thực với Strava');

  const { error } = await supabase
    .from('profiles')
    .update({
      strava_connected: true,
      strava_access_token: data.access_token,
      strava_refresh_token: data.refresh_token,
      strava_expires_at: data.expires_at,
    })
    .eq('id', userId);

  if (error) throw error;
  return data;
}

export async function syncStravaActivities(accessToken: string) {
  const response = await fetch('https://www.strava.com/api/v3/athlete/activities?per_page=10', {
    headers: { Authorization: `Bearer ${accessToken}` },
  });

  const activities = await response.json();
  if (!response.ok) throw new Error('Không thể tải danh sách bài chạy từ Strava');

  return activities;
}
