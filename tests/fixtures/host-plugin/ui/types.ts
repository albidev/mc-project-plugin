export interface HostPluginManifest {
  id: string;
  name: string;
  routePath: string;
  endpoints: Array<{ method: 'GET' | 'POST'; path: string; handler: string; authRequired: true }>;
}
