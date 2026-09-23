// Lấy domain công khai (quan trọng khi chạy sau proxy như Codespaces/Vercel,
// nơi request.url bên trong container có thể là localhost).
export function getPublicOrigin(request: Request): string {
  const forwardedHost = request.headers.get('x-forwarded-host')
  const forwardedProto = request.headers.get('x-forwarded-proto') || 'https'
  if (forwardedHost) return `${forwardedProto}://${forwardedHost}`
  return new URL(request.url).origin
}
