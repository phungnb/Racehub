// Cổng công khai của module race (giải chạy ảo). Code ngoài module chỉ import từ '@/features/race'.
export { RacesScreen } from './components/RacesScreen'
export { RaceDetailScreen } from './components/RaceDetailScreen'
export { CreateRaceScreen } from './components/CreateRaceScreen'
export { useOrganizer } from './hooks/useOrganizer'
// Mẫu chứng nhận dùng lại cho chứng nhận chiến dịch tổ chức (008400)
export {
  autoCert, CERT_BINDS, CERT_COLOR_LABEL, CERT_FORMATS, CERT_TEMPLATES, certPayload, drawCertificate, editableCert, keepCertAssets, resolveCert,
  type CertDesign, type CertFormat, type CertTemplate, type CertificateData, type StoredCert,
} from './model/certificate'
