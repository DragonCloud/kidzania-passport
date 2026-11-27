import { EMPTY_CHILD } from '../config/defaults';
import { db, type AppDB } from '../db/db';
import type { ChildProfile } from '../types/models';
import { isValidBirthday } from './age';

export async function getChild(d: AppDB = db): Promise<ChildProfile> {
  return (await d.child.get('kid')) ?? EMPTY_CHILD;
}

export async function saveChild(patch: Partial<Omit<ChildProfile, 'id'>>, d: AppDB = db): Promise<ChildProfile> {
  if (patch.birthday != null && !isValidBirthday(patch.birthday)) throw new Error('生日格式不正確或在未來');
  const next: ChildProfile = { ...(await getChild(d)), ...patch, id: 'kid' };
  next.name = next.name.trim();
  await d.child.put(next);
  return next;
}
