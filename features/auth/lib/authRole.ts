export const ROLES = {
  SYSTEM_ADMIN: 'SYSTEM_ADMIN',
  CLUB_ADMIN: 'CLUB_ADMIN',
  MEMBER: 'MEMBER',
}

export function isSystemAdmin(profile: any) {
  return profile?.role === ROLES.SYSTEM_ADMIN
}

export function isClubAdmin(profile: any) {
  return profile?.role === ROLES.CLUB_ADMIN || profile?.role === ROLES.SYSTEM_ADMIN
}