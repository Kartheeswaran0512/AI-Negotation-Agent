/**
 * Route parameters.
 *
 * Ids are carried as strings because they arrive from the server as either a
 * number (MySQL BIGINT) or a string, and a route param that changes type
 * between environments is a bug waiting to happen.
 */

export type RootStackParamList = {
  Home: undefined;
  Settings: { firstRun?: boolean } | undefined;
  NewRequirement: undefined;
  Requirement: { requirementId: string };
  AddSupplier: { requirementId: string };
  Negotiation: { negotiationId: string; requirementId?: string };
  AuditTrail: { negotiationId: string; requirementId?: string };
  Accept: { negotiationId: string; requirementId: string };
  Tools: undefined;
};

declare global {
  // eslint-disable-next-line @typescript-eslint/no-namespace
  namespace ReactNavigation {
    interface RootParamList extends RootStackParamList {}
  }
}
