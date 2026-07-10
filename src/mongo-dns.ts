import dns from 'dns';

const DEFAULT_MONGODB_DNS_SERVERS = ['8.8.8.8', '1.1.1.1'];

export function configureMongoSrvDns(uri?: string) {
  if (!uri?.startsWith('mongodb+srv://')) {
    return;
  }

  const servers =
    process.env.MONGODB_DNS_SERVERS?.split(',')
      .map((server) => server.trim())
      .filter(Boolean) || DEFAULT_MONGODB_DNS_SERVERS;

  dns.setServers(servers);
}
