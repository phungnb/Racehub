// Vá plugin @capacitor-community/background-geolocation cho iOS (chạy tự động sau `npm install`, và trước `cap sync`):
// - activityType = .fitness: báo cho iOS đây là chạy bộ / đi bộ → Core Location lọc tín hiệu theo kiểu người đi bộ
//   (Apple khuyến nghị cho app thể thao; Strava, Nike Run Club dùng cấu hình này). Mặc định plugin để .other.
// Idempotent: chạy nhiều lần không sao; thiếu file (máy build web không có plugin) thì bỏ qua.
import { readFileSync, writeFileSync, existsSync } from 'node:fs'

const file = 'node_modules/@capacitor-community/background-geolocation/ios/Plugin/Swift/Plugin.swift'
const anchor = 'manager.pausesLocationUpdatesAutomatically = false'
const line = 'manager.activityType = .fitness // RaceHub: chạy bộ'

if (!existsSync(file)) process.exit(0)
const src = readFileSync(file, 'utf8')
if (src.includes(line)) process.exit(0)
if (!src.includes(anchor)) {
  console.warn('[patch-native-gps] Không tìm thấy chỗ vá trong plugin iOS (plugin đổi phiên bản?) — bỏ qua.')
  process.exit(0)
}
writeFileSync(file, src.replace(anchor, `${anchor}\n            ${line}`))
console.log('[patch-native-gps] iOS: activityType = .fitness')
