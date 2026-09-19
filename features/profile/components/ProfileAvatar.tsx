'use client'

import React from 'react'
import { CharacterCanvas } from '@/features/character'
import { CharacterAvatarData, CharacterEquipmentData } from '@/features/character/lib/characterTypes'

export default function ProfileAvatar({ avatar, equipment }: { avatar?: CharacterAvatarData, equipment?: CharacterEquipmentData }) {
  return <CharacterCanvas avatar={avatar} equipment={equipment} />
}
