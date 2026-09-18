import { supabase } from '@/lib/supabase'
import { processActivityThroughRaceHubEngine } from '@/lib/racehubEngine'

/**
 * Giả lập luồng đồng bộ bài chạy thực tế từ Strava cho một User
 */
export async function syncAndProcessUserActivities(profileId: string, stravaAccessToken: string) {
  console.log("🔄 Đang đồng bộ bài chạy mới từ Strava cho user:", profileId);

  // 1. Gọi API Strava lấy các bài chạy mới nhất (Ví dụ mẫu dữ liệu trả về từ Strava)
  // const stravaActivities = await fetchFromStrava(stravaAccessToken);
  
  // Giả sử ta nhận được một bài chạy mới từ Strava
  const newActivityFromStrava = {
    id: "act_998877",
    distance_m: 21100, // 21.1 km (HM)
    moving_time_s: 7380, // 2 giờ 03 phút
    elapsed_time_s: 7500,
    average_heart_rate: 155,
    activity_type: "RUN",
    source: "STRAVA",
    activity_date: new Date().toISOString()
  };

  // 2. Lưu bài chạy vào bảng lịch sử hoạt động chung của hệ thống (ví dụ: bảng activities)
  const { data: savedActivity, error: saveError } = await supabase
    .from('activities')
    .upsert({
      profile_id: profileId,
      strava_activity_id: newActivityFromStrava.id,
      distance_m: newActivityFromStrava.distance_m,
      moving_time_s: newActivityFromStrava.moving_time_s,
      elapsed_time_s: newActivityFromStrava.elapsed_time_s,
      average_heart_rate: newActivityFromStrava.average_heart_rate,
      activity_type: newActivityFromStrava.activity_type,
      source: newActivityFromStrava.source,
      activity_date: newActivityFromStrava.activity_date
    }, { onConflict: 'strava_activity_id' })
    .select()
    .single();

  if (saveError) {
    console.error("❌ Lỗi lưu bài chạy:", saveError.message);
    return;
  }

  console.log("💾 Đã lưu bài chạy thành công vào CSDL. Kích hoạt RaceHub Engine...");

  // 3. 🚀 KÍCH HOẠT RACEHUB ENGINE ĐỂ CHẤM ĐIỂM THỬ THÁCH TỰ ĐỘNG
  const engineResult = await processActivityThroughRaceHubEngine(profileId, {
    distance_m: newActivityFromStrava.distance_m,
    moving_time_s: newActivityFromStrava.moving_time_s,
    elapsed_time_s: newActivityFromStrava.elapsed_time_s,
    average_heart_rate: newActivityFromStrava.average_heart_rate,
    activity_type: newActivityFromStrava.activity_type,
    source: newActivityFromStrava.source,
    activity_date: newActivityFromStrava.activity_date
  });

  console.log("🎯 Kết quả xử lý từ RaceHub Engine:", engineResult);
  return { success: true, engineResult };
}