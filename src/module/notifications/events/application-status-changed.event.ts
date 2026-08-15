import { ApplicationStatus } from '../../../../generated/prisma/enums.js';

export interface ApplicationStatusChangedEvent {
  applicationId: string;
  candidateId: string;
  jobTitle: string;
  status: ApplicationStatus;
  meetingLink?: string | null;
}
