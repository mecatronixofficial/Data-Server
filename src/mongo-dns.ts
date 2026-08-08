import dns from 'dns';

export function configureMongoSrvDns(uri?: string) {
  if (!uri?.startsWith('mongodb+srv://')) {
    return;
  }

  const servers = process.env.MONGODB_DNS_SERVERS?.split(',')
    .map((server) => server.trim())
    .filter(Boolean);

  // Keep the host resolver by default. Public resolvers can break private
  // MongoDB endpoints and should only be an explicit deployment override.
  if (servers?.length) dns.setServers(servers);
}
