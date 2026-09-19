'use client'

import { useState, useEffect, useRef } from 'react'
import { supabase } from '@/shared/lib/supabase'

interface RunTabProps {
  profile: any;
  onActivitySaved: () => void;
}

type TrackState = 'IDLE' | 'STARTING' | 'RUNNING' | 'PAUSED' | 'FINISHED' | 'SAVING'

export default function RunTab({ profile, onActivitySaved }: RunTabProps) {
  const [trackState, setTrackState] = useState<TrackState>('IDLE')
  
  // Thời gian & Thông số
  const [elapsedSeconds, setElapsedSeconds] = useState(0)
  const [movingSeconds, setMovingSeconds] = useState(0)
  const [distanceMeters, setDistanceMeters] = useState(0)
  const [currentPace, setCurrentPace] = useState(0)
  const [gpsStatus, setGpsStatus] = useState<'ACQUIRING' | 'GOOD' | 'WEAK' | 'LOST'>('ACQUIRING')
  
  const startTimeRef = useRef<Date | null>(null)
  const trackPointsRef = useRef<any[]>([])
  const timerRef = useRef<any>(null)
  const watchIdRef = useRef<number | null>(null)
  const lastCoordsRef = useRef<{ latitude: number; longitude: number; timestamp: number } | null>(null)

  // Hàm Haversine tính khoảng cách (mét)
  const calculateHaversine = (lat1: number, lon1: number, lat2: number, lon2: number) => {
    const R = 6371e3;
    const φ1 = (lat1 * Math.PI) / 180;
    const φ2 = (lat2 * Math.PI) / 180;
    const Δφ = ((lat2 - lat1) * Math.PI) / 180;
    const Δλ = ((lon2 - lon1) * Math.PI) / 180;

    const a = Math.sin(Δφ / 2) ** 2 + Math.cos(φ1) * Math.cos(φ2) * Math.sin(Δλ / 2) ** 2;
    return R * (2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a)));
  };

  // State Machine: Xử lý STARTING -> xin GPS ổn định trước khi chạy thật
  useEffect(() => {
    if (trackState === 'STARTING') {
      if ('geolocation' in navigator) {
        navigator.geolocation.getCurrentPosition(
          (position) => {
            const { accuracy } = position.coords;
            if (accuracy <= 40) {
              setGpsStatus('GOOD');
              startTimeRef.current = new Date();
              setTrackState('RUNNING');
            } else {
              setGpsStatus('WEAK');
              // Vẫn cho phép vào RUNNING nhưng cảnh báo
              startTimeRef.current = new Date();
              setTrackState('RUNNING');
            }
          },
          (err) => {
            console.warn("Lỗi cấp quyền GPS:", err.message);
            setGpsStatus('LOST');
 
          },
          { enableHighAccuracy: true, timeout: 8000, maximumAge: 0 }
        );
      } else {
        alert("Trình duyệt của bạn không hỗ trợ định vị GPS.");
        setTrackState('IDLE');
      }
    }
  }, [trackState]);

  // Quản lý Timer và GPS Tracking khi ở trạng thái RUNNING
  useEffect(() => {
    if (trackState === 'RUNNING') {
      timerRef.current = setInterval(() => {
        setElapsedSeconds((s) => s + 1);
        setMovingSeconds((s) => s + 1); // Chỉ tăng khi chạy thực tế
      }, 1000);

      if ('geolocation' in navigator) {
        watchIdRef.current = navigator.geolocation.watchPosition(
          (position) => {
            const { latitude, longitude, accuracy, altitude, speed } = position.coords;
            const nowTime = position.timestamp || Date.now();

            if (accuracy > 50) {
              setGpsStatus('WEAK');
              return;
            }
            setGpsStatus('GOOD');

            if (lastCoordsRef.current) {
              const dist = calculateHaversine(
                lastCoordsRef.current.latitude,
                lastCoordsRef.current.longitude,
                latitude,
                longitude
              );

              const timeDeltaSec = (nowTime - lastCoordsRef.current.timestamp) / 1000.0;
              const impliedSpeed = timeDeltaSec > 0 ? dist / timeDeltaSec : 0;

              // Bộ lọc GPS thông minh: Khoảng cách từ 1m đến 50m và tốc độ tức thời hợp lý (< 12 m/s ~ 43 km/h)
              if (dist >= 1 && dist <= 50 && impliedSpeed < 12) {
                setDistanceMeters((prev) => {
                  const newDist = prev + dist;
                  if (impliedSpeed > 0) {
                    setCurrentPace(1000 / impliedSpeed);
                  }
                  return newDist;
                });

                trackPointsRef.current.push({
                  latitude,
                  longitude,
                  accuracy,
                  altitude: altitude || 0,
                  speed: speed || impliedSpeed,
                  recorded_at: new Date(nowTime).toISOString()
                });

                // Chỉ cập nhật mốc khi điểm thực sự hợp lệ
                lastCoordsRef.current = { latitude, longitude, timestamp: nowTime };
              }
            } else {
              // Điểm khởi đầu
              trackPointsRef.current.push({
                latitude,
                longitude,
                accuracy,
                altitude: altitude || 0,
                speed: speed || 0,
                recorded_at: new Date(nowTime).toISOString()
              });
              lastCoordsRef.current = { latitude, longitude, timestamp: nowTime };
            }
          },
          (err) => {
            console.warn("Mất tín hiệu GPS:", err.message);
            setGpsStatus(err.code === 1 ? 'LOST' : 'WEAK');
          },
          { enableHighAccuracy: true, maximumAge: 3000, timeout: 7000 }
        );
      }
    } else {
      if (timerRef.current) clearInterval(timerRef.current);
      if (watchIdRef.current !== null && 'geolocation' in navigator) {
        navigator.geolocation.clearWatch(watchIdRef.current);
      }
    }

    return () => {
      if (timerRef.current) clearInterval(timerRef.current);
      if (watchIdRef.current !== null && 'geolocation' in navigator) {
        navigator.geolocation.clearWatch(watchIdRef.current);
      }
    };
  }, [trackState]);

  const formatTime = (totalSeconds: number) => {
    const hrs = Math.floor(totalSeconds / 3600);
    const mins = Math.floor((totalSeconds % 3600) / 60);
    const secs = totalSeconds % 60;
    return `${hrs > 0 ? `${hrs.toString().padStart(2, '0')}:` : ''}${mins.toString().padStart(2, '0')}:${secs.toString().padStart(2, '0')}`;
  };

  const formatPace = (paceSec: number) => {
    if (!paceSec || paceSec === 0 || !isFinite(paceSec)) return "--:--";
    const mins = Math.floor(paceSec / 60);
    const secs = Math.floor(paceSec % 60);
    return `${mins}:${secs.toString().padStart(2, '0')}`;
  };

  // Gửi gói dữ liệu lên Server RPC
  const handleSaveActivity = async () => {
    if (!profile) return;
    setTrackState('SAVING');

    const totalKm = distanceMeters / 1000.0;
    // Pace trung bình tính CHÍNH XÁC bằng Moving Time / Distance
    const avgPaceSec = totalKm > 0 ? Math.round(movingSeconds / totalKm) : 0;
    const endedAt = new Date();

    const payload = {
      p_user_id: profile.id,
      p_title: `Buổi chạy ngày ${new Date().toLocaleDateString('vi-VN')}`,
      p_source: 'DIRECT_GPS',
      p_started_at: startTimeRef.current ? startTimeRef.current.toISOString() : new Date().toISOString(),
      p_ended_at: endedAt.toISOString(),
      p_elapsed_s: elapsedSeconds,
      p_moving_s: movingSeconds,
      p_distance_m: Math.round(distanceMeters),
      p_avg_pace_s: avgPaceSec,
      p_track_points: trackPointsRef.current
    };

    try {
      const { data, error } = await supabase.rpc('submit_and_process_activity', payload);

      if (error) {
        console.error("Lỗi RPC submit_and_process_activity:", error);
        alert(`Lưu hoạt động thất bại: ${error.message}`);
        setTrackState('FINISHED');
        return;
      }

      if (data && data.success) {
        alert(`🎉 Lưu thành công! Trạng thái: ${data.validation_status} | Thưởng: +${data.earned_xp} XP, +${data.earned_xu} Xu`);
        
        // Reset toàn bộ state
        setTrackState('IDLE');
        setElapsedSeconds(0);
        setMovingSeconds(0);
        setDistanceMeters(0);
        setCurrentPace(0);
        trackPointsRef.current = [];
        lastCoordsRef.current = null;
        startTimeRef.current = null;
        
        onActivitySaved();
      } else {
        alert("Hệ thống máy chủ từ chối xử lý hoạt động.");
        setTrackState('FINISHED');
      }
    } catch (err: any) {
      console.error("Lỗi ngoại lệ khi lưu:", err);
      alert("Đã xảy ra lỗi kết nối đến máy chủ.");
      setTrackState('FINISHED');
    }
  };

  return (
    <div className="space-y-6 animate-fadeIn text-center py-4">
      {trackState === 'IDLE' && (
        <div className="bg-slate-900 border border-slate-800 rounded-3xl p-6 shadow-2xl space-y-6">
          <div className="w-20 h-20 bg-orange-500/20 text-orange-400 rounded-full mx-auto flex items-center justify-center text-3xl shadow-inner">
            ⚡
          </div>
          <div>
            <h2 className="text-xl font-bold">Tracking Trực Tiếp</h2>
            <p className="text-xs text-slate-400 mt-1">Bật GPS và sẵn sàng ghi lại buổi chạy chuẩn RaceHub Engine.</p>
          </div>
          <button 
            onClick={() => setTrackState('STARTING')}
            className="w-full bg-orange-500 hover:bg-orange-600 text-slate-950 font-black py-4 rounded-2xl text-base transition-all shadow-xl shadow-orange-500/30 cursor-pointer"
          >
            BẮT ĐẦU CHẠY 🚀
          </button>
        </div>
      )}

    {trackState === 'STARTING' && (
        <div className="bg-slate-900 border border-slate-800 rounded-3xl p-6 text-center space-y-4 shadow-2xl">
          <div className="text-3xl animate-bounce">📡</div>
          <h3 className="text-sm font-bold text-orange-400">Đang tìm tín hiệu GPS & xin quyền định vị...</h3>
          <p className="text-xs text-slate-400">Vui lòng cho phép quyền truy cập vị trí trên trình duyệt.</p>
          
          {/* NÚT GIẢ LẬP DỰ PHÒNG KHI TEST TRÊN MÁY TÍNH / BỊ CHẶN GPS */}
          <button 
            onClick={() => {
              // Gán tọa độ giả lập (Ví dụ khu vực TP.HCM / Đồng Nai) để test hệ thống
              startTimeRef.current = new Date();
              lastCoordsRef.current = { latitude: 10.7769, longitude: 106.7009, timestamp: Date.now() };
              setGpsStatus('GOOD');
              setTrackState('RUNNING');
            }}
            className="w-full bg-slate-800 hover:bg-slate-700 text-orange-400 font-bold py-2.5 rounded-xl text-xs cursor-pointer border border-orange-500/30"
          >
            ⚡ Bỏ qua GPS (Chế độ giả lập test)
          </button>
        </div>
      )}

      {(trackState === 'RUNNING' || trackState === 'PAUSED') && (
        <div className="bg-slate-900 border border-slate-800 rounded-3xl p-6 shadow-2xl space-y-6">
          <div className="flex justify-between items-center px-2">
            <span className={`text-[10px] font-bold px-2.5 py-1 rounded-full ${gpsStatus === 'GOOD' ? 'bg-emerald-500/20 text-emerald-400' : 'bg-amber-500/20 text-amber-400'}`}>
              GPS: {gpsStatus}
            </span>
            <span className="text-xs text-slate-400 uppercase font-bold tracking-widest">{trackState}</span>
          </div>

          <div className="grid grid-cols-2 gap-4">
            <div className="bg-slate-950 p-4 rounded-2xl border border-slate-800">
              <span className="text-[10px] text-slate-500 block uppercase">Quãng đường</span>
              <span className="text-3xl font-black text-white">{(distanceMeters / 1000).toFixed(2)}</span>
              <span className="text-xs text-slate-400 ml-1">km</span>
            </div>
            <div className="bg-slate-950 p-4 rounded-2xl border border-slate-800">
              <span className="text-[10px] text-slate-500 block uppercase">Moving Time</span>
              <span className="text-2xl font-black text-orange-400 font-mono">{formatTime(movingSeconds)}</span>
            </div>
          </div>

          <div className="bg-slate-950 p-3 rounded-2xl border border-slate-800">
            <span className="text-[10px] text-slate-500 block uppercase">Pace Trung Bình (Moving)</span>
            <span className="text-xl font-bold text-amber-400 font-mono">
              {formatPace(distanceMeters > 0 ? movingSeconds / (distanceMeters / 1000) : 0)} /km
            </span>
          </div>

          <div className="flex gap-3">
            {trackState === 'RUNNING' ? (
              <button 
                onClick={() => setTrackState('PAUSED')}
                className="flex-1 bg-amber-500 hover:bg-amber-600 text-slate-950 font-bold py-3.5 rounded-2xl cursor-pointer"
              >
                Tạm dừng ⏸️
              </button>
            ) : (
              <button 
                onClick={() => setTrackState('RUNNING')}
                className="flex-1 bg-emerald-500 hover:bg-emerald-600 text-slate-950 font-bold py-3.5 rounded-2xl cursor-pointer"
              >
                Tiếp tục ▶️
              </button>
            )}
            <button 
              onClick={() => setTrackState('FINISHED')}
              className="flex-1 bg-rose-600 hover:bg-rose-500 text-white font-bold py-3.5 rounded-2xl cursor-pointer"
            >
              Kết thúc 🏁
            </button>
          </div>
        </div>
      )}

      {trackState === 'FINISHED' && (
        <div className="bg-slate-900 border border-slate-800 rounded-3xl p-6 shadow-2xl space-y-5">
          <h2 className="text-lg font-bold text-orange-400">🏁 Tổng kết buổi chạy</h2>
          <div className="space-y-2 bg-slate-950 p-4 rounded-2xl text-left text-xs">
            <div className="flex justify-between py-1 border-b border-slate-800">
              <span className="text-slate-400">Tổng quãng đường:</span>
              <span className="font-bold text-white">{(distanceMeters / 1000).toFixed(2)} km</span>
            </div>
            <div className="flex justify-between py-1 border-b border-slate-800">
              <span className="text-slate-400">Moving Time:</span>
              <span className="font-bold text-white">{formatTime(movingSeconds)}</span>
            </div>
            <div className="flex justify-between py-1 border-b border-slate-800">
              <span className="text-slate-400">Elapsed Time:</span>
              <span className="font-bold text-white">{formatTime(elapsedSeconds)}</span>
            </div>
            <div className="flex justify-between py-1">
              <span className="text-slate-400">Pace trung bình:</span>
              <span className="font-bold text-amber-400">
                {formatPace(distanceMeters > 0 ? movingSeconds / (distanceMeters / 1000) : 0)} /km
              </span>
            </div>
          </div>

          <div className="flex gap-3">
            <button 
              onClick={() => setTrackState('RUNNING')}
              className="flex-1 bg-slate-800 hover:bg-slate-700 text-slate-300 font-bold py-3 rounded-xl text-xs cursor-pointer"
            >
              Tiếp tục chạy
            </button>
            <button 
              onClick={handleSaveActivity}
              className="flex-2 bg-orange-500 hover:bg-orange-600 text-slate-950 font-black py-3 rounded-xl text-xs cursor-pointer shadow-lg"
            >
              Đồng bộ lên Server 💾
            </button>
          </div>
        </div>
      )}

      {trackState === 'SAVING' && (
        <div className="bg-slate-900 border border-slate-800 rounded-3xl p-10 text-center text-slate-400 space-y-3">
          <div className="text-2xl animate-spin">⏳</div>
          <p className="text-xs">Đang thực hiện Server Transaction: Validation Engine, Reward Ledger & Challenge Engine...</p>
        </div>
      )}
    </div>
  )
}