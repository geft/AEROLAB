/** The selected FIT session owns the activity's environment, not its editable name. */
export function isTreadmillFitMetadata(metadata?: Record<string, unknown> | null): boolean {
  const session = metadata?.session;
  if (!session || typeof session !== 'object' || Array.isArray(session)) return false;
  const fields = session as Record<string, unknown>;
  return fields.sub_sport === 'treadmill' ||
    (typeof fields.sport_profile_name === 'string' && fields.sport_profile_name.toLowerCase() === 'treadmill');
}
