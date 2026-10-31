export const ACTIVE_APPOINTMENT_STATUSES = ['CONFIRMED', 'IN_PROGRESS'] as const;

export const STATUS_TRANSITIONS: Record<string, string[]> = {
  CONFIRMED: ['IN_PROGRESS', 'CANCELLED'],
  IN_PROGRESS: ['COMPLETED'],
  COMPLETED: [],
  CANCELLED: []
};

export function overlaps(existingStart: Date, existingEnd: Date, newStart: Date, newEnd: Date) {
  return existingStart < newEnd && existingEnd > newStart;
}

export function canTransition(current: string, next: string) {
  return STATUS_TRANSITIONS[current]?.includes(next) ?? false;
}

export function totalDuration(services: Array<{ duration_minutes: number }>) {
  return services.reduce((sum, service) => sum + service.duration_minutes, 0);
}
