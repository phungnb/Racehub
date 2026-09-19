import { supabase } from '@/shared/lib/supabase'

/**
 * RACEHUB ENGINE - CHẠY NGẨM XỬ LÝ BÀI CHẠY VÀ CẬP NHẬT TIẾN ĐỘ THỬ THÁCH
 * @param {string} profileId - ID của runner
 * @param {object} activity - Dữ liệu bài chạy vừa đồng bộ (dist_km, time_sec, pace_sec, heart_rate, date, type)
 */
export async function processActivityThroughRaceHubEngine(profileId: string, activity: {
  distance_m: number;
  moving_time_s: number;
  elapsed_time_s: number;
  average_heart_rate?: number;
  activity_type: string;
  source: string;
  activity_date: string;
}) {
  console.log("⚙️ RaceHub Engine đang phân tích bài chạy cho user:", profileId);

  // --- STAGE 1: ACTIVITY VALIDATION (LỌC CƠ BẢN) ---
  if (activity.activity_type !== 'RUN') {
    console.log("❌ Bị loại: Không phải môn Chạy (RUN).");
    return { valid: false, reason: 'NOT_RUN_ACTIVITY' };
  }

  // --- STAGE 2: LẤY CÁC THỬ THÁCH MÀ USER ĐANG THAM GIA ---
  const { data: participations, error: partError } = await supabase
    .from('challenge_participants')
    .select(`
      id,
      challenge_id,
      status,
      current_progress,
      challenges (
        id,
        objective_type,
        start_at,
        end_at,
        status,
        challenge_rules (*)
      )
    `)
    .eq('profile_id', profileId)
    .eq('status', 'JOINED');

  if (partError || !participations) {
    console.log("ℹ️ User không tham gia thử thách nào active.");
    return { valid: true, processed_challenges: 0 };
  }

  const actDate = new Date(activity.activity_date).getTime();

  for (const part of participations) {
    const challenge: any = part.challenges;
    const rules: any = challenge.challenge_rules;

    // Kiểm tra thời gian thử thách (Time Engine)
    const startAt = new Date(challenge.start_at).getTime();
    const endAt = new Date(challenge.end_at).getTime();
    if (actDate < startAt || actDate > endAt) continue;

    // Kiểm tra điều kiện bài chạy tối thiểu (Condition Engine)
    if (activity.distance_m < rules.minimum_distance_m) continue;

    // Kiểm tra nhịp tim nếu bắt buộc
    if (rules.require_heart_rate && (!activity.average_heart_rate || activity.average_heart_rate <= 0)) continue;

    let isQualified = false;
    let progressDelta = 0;

    // --- STAGE 3: ĐỐI CHƯỚC THEO 4 OBJECTIVE CHUẨN ---
    switch (challenge.objective_type) {
      case 'VOLUME':
        // Tích lũy: Cộng dồn cự ly
        progressDelta = activity.distance_m / 1000; // Đổi ra Km
        isQualified = true;
        break;

      case 'DISTANCE':
        // Chinh phục cự ly: 1 bài chạy đạt hoặc vượt cự ly mục tiêu
        if (activity.distance_m >= rules.target_distance_m) {
          isQualified = true;
          progressDelta = rules.target_distance_m / 1000;
        }
        break;

      case 'PERFORMANCE':
        // Thành tích: 1 bài chạy đạt cự ly + đạt Cut-off Time
        const checkTime = rules.time_metric === 'ELAPSED_TIME' ? activity.elapsed_time_s : activity.moving_time_s;
        if (activity.distance_m >= rules.target_distance_m && checkTime <= rules.cutoff_time_s) {
          isQualified = true;
          progressDelta = rules.target_distance_m / 1000;
        }
        break;

      case 'STREAK':
        // Chuỗi ngày: Kiểm tra cự ly bài chạy >= tiêu chuẩn ngày
        // (Logic xử lý ngày duy nhất trong hệ thống chuỗi)
        isQualified = true;
        progressDelta = 1; // Tăng 1 ngày hoàn thành
        break;
    }

    if (isQualified) {
      const newProgress = (part.current_progress || 0) + progressDelta;
      
      // Kiểm tra xem đã hoàn thành mục tiêu chưa
      const isCompleted = newProgress >= (rules.target_value || 0);

      await supabase
        .from('challenge_participants')
        .update({
          current_progress: newProgress,
          status: isCompleted ? 'COMPLETED' : 'JOINED',
          score: newProgress
        })
        .eq('id', part.id);

      console.log(`✅ Đã cập nhật tiến độ cho thử thách [${challenge.id}]: +${progressDelta} (Tổng: ${newProgress})`);
    }
  }

  return { valid: true, processed_challenges: participations.length };
}