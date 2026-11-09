import type { Catalog, CatalogComponent, ConditionValue, Figure, Published, Source } from './published'

/**
 * The component catalog: one entry per component, whoever runs it, with the figures published for it under their
 * conditions. Imported on its own (`@loadmap/core/catalog`), so no page loads it unless it uses it.
 *
 * Every number here was read on its source page on the `checked` day. A released edition never changes
 * (catalog.test.ts holds each one): a correction or a newer run goes into the next edition.
 */

const CHECKED = '2026-11-09'

/** One figure per row of a published table: [the conditions that differ, the value]. */
const rows = (
  base: Omit<Figure, 'id' | 'value' | 'when'>,
  id: (when: Readonly<Record<string, ConditionValue>>) => string,
  cells: readonly (readonly [when: Readonly<Record<string, ConditionValue>>, value: number])[],
): Figure[] => cells.map(([when, value]) => ({ ...base, id: id(when), value, when }))

const omb2020: Source = {
  title: 'Benchmarking Apache Kafka, Apache Pulsar, and RabbitMQ: Which is the Fastest?',
  url: 'https://www.confluent.io/blog/kafka-fastest-messaging-system/',
  by: 'Confluent',
  date: '2020-08-21',
  checked: CHECKED,
}
const ombRun = [
  'brokers of 8 vCPU, 64 GB, 2 × 2.5 TB NVMe, 25 Gbps (AWS i3en.2xlarge)',
  '100 partitions, 4 producers and 4 consumers',
  'min.insync.replicas 2, batch.size 1 MB, linger.ms 10, flushing left to the OS page cache',
  'OpenMessaging Benchmark, Java 11',
]
const linkedin2014: Source = {
  title: 'Benchmarking Apache Kafka: 2 Million Writes Per Second (On Three Cheap Machines)',
  url: 'https://engineering.linkedin.com/kafka/benchmarking-apache-kafka-2-million-writes-second-three-cheap-machines',
  by: 'LinkedIn',
  date: '2014-04-27',
  checked: CHECKED,
}
const linkedinRun = [
  'brokers of 6-core Xeon 2.5 GHz, 32 GB, 6 × 7200 rpm SATA (JBOD), 1 GbE',
  '6 partitions, 50 million records, no consumers; MB/s counts the values only',
  'acks as in the commands the post links',
]

const kafkaDef: CatalogComponent = {
  id: 'kafka',
  name: 'Apache Kafka',
  about: 'A distributed log: brokers hold the partitions of topics.',
  kind: 'stream',
  box: 'cluster',
  tags: ['Kafka', 'streaming', 'broker'],
  versionMatters: false,
  conditions: {
    brokers: { label: 'brokers', doc: 'Brokers in the cluster.', unit: 'brokers' },
    replication: { label: 'replication factor', doc: 'Copies of each partition.' },
    acks: { label: 'acks', doc: 'What a producer waits for: all (every in-sync replica) or 1 (the leader).' },
    messageSize: { label: 'message size', doc: 'The size of each message.' },
    producers: { label: 'producers', doc: 'Producers writing at once.', unit: 'producers' },
  },
  figures: [
    {
      id: 'omb-2020',
      measure: 'capacity',
      value: 605,
      unit: 'MB/s',
      what: 'peak throughput, produced and consumed',
      scope: 'for the whole cluster',
      when: { brokers: 3, replication: 3, acks: 'all', messageSize: '1 KB', producers: 4 },
      conditions: ombRun,
      versions: ['2.6'],
      source: omb2020,
    },
    {
      id: 'omb-2020-latency',
      measure: 'latency',
      value: 5,
      unit: 'ms',
      what: 'p99 latency at 200 MB/s',
      scope: 'for the whole cluster',
      when: { brokers: 3, replication: 3, acks: 'all', messageSize: '1 KB', producers: 4 },
      conditions: ombRun,
      versions: ['2.6'],
      source: omb2020,
    },
    {
      id: 'linkedin-2014',
      measure: 'capacity',
      value: 193,
      unit: 'MB/s',
      what: 'produce throughput, 2,024,032 records/s, asynchronous replication',
      scope: 'for the whole cluster',
      when: { brokers: 3, replication: 3, acks: '1', messageSize: '100 B', producers: 3 },
      conditions: linkedinRun,
      versions: ['0.8.1'],
      source: linkedin2014,
    },
    {
      id: 'linkedin-2014-async',
      measure: 'capacity',
      value: 75.1,
      unit: 'MB/s',
      what: 'produce throughput, 786,980 records/s, asynchronous replication',
      scope: 'for the whole cluster',
      when: { brokers: 3, replication: 3, acks: '1', messageSize: '100 B', producers: 1 },
      conditions: linkedinRun,
      versions: ['0.8.1'],
      source: linkedin2014,
    },
    {
      id: 'linkedin-2014-sync',
      measure: 'capacity',
      value: 40.2,
      unit: 'MB/s',
      what: 'produce throughput, 421,823 records/s, synchronous replication',
      scope: 'for the whole cluster',
      when: { brokers: 3, replication: 3, acks: 'all', messageSize: '100 B', producers: 1 },
      conditions: linkedinRun,
      versions: ['0.8.1'],
      source: linkedin2014,
    },
  ],
}

const amqp2024: Source = {
  title: 'AMQP 1.0 Benchmarks',
  url: 'https://www.rabbitmq.com/blog/2024/08/21/amqp-benchmarks',
  by: 'the RabbitMQ team',
  date: '2024-08-21',
  checked: CHECKED,
}
const amqpRun = [
  'one node on an Intel NUC 11 (8 cores, 32 GB), 3 Erlang schedulers (+S 3), Erlang/OTP 27.0.1',
  'the clients on the same machine, 1 million messages, measured end to end',
]
const RAISED =
  'flow control raised: credit_flow_default_credit {5000, 2500}, max_incoming_window 5000, max_link_credit 2000, max_queue_credit 5000'

const rabbitmqDef: CatalogComponent = {
  id: 'rabbitmq',
  name: 'RabbitMQ',
  about: 'A message broker: queues and streams over AMQP.',
  kind: 'queue',
  box: 'node',
  tags: ['AMQP', 'broker', 'queue'],
  versionMatters: true,
  conditions: {
    nodes: { label: 'nodes', doc: 'Nodes in the cluster.', unit: 'nodes' },
    queueType: { label: 'queue type', doc: 'quorum, classic or stream.' },
    protocol: { label: 'protocol', doc: 'AMQP 1.0 or AMQP 0.9.1.' },
    messageSize: { label: 'message size', doc: 'The size of each message.' },
    flowControl: { label: 'flow control', doc: 'default, or raised (larger credits and windows).' },
  },
  figures: rows(
    {
      measure: 'capacity',
      unit: 'msg/s',
      what: 'messages through the queue',
      scope: 'for one node',
      conditions: amqpRun,
      versions: ['4.0'],
      source: amqp2024,
    },
    (w) =>
      `${w.queueType}-amqp-${String(w.protocol).replace('AMQP ', '')}${w.flowControl === 'raised' ? '-raised' : ''}`,
    [
      [{ nodes: 1, queueType: 'quorum', protocol: 'AMQP 1.0', messageSize: '12 B', flowControl: 'raised' }, 83_181],
      [{ nodes: 1, queueType: 'quorum', protocol: 'AMQP 0.9.1', messageSize: '12 B', flowControl: 'raised' }, 70_067],
      [{ nodes: 1, queueType: 'quorum', protocol: 'AMQP 1.0', messageSize: '12 B', flowControl: 'default' }, 9_983],
      [{ nodes: 1, queueType: 'quorum', protocol: 'AMQP 0.9.1', messageSize: '12 B', flowControl: 'default' }, 9_931],
      [{ nodes: 1, queueType: 'classic', protocol: 'AMQP 1.0', messageSize: '12 B', flowControl: 'default' }, 99_413],
      [{ nodes: 1, queueType: 'classic', protocol: 'AMQP 0.9.1', messageSize: '12 B', flowControl: 'default' }, 88_534],
      [{ nodes: 1, queueType: 'stream', protocol: 'AMQP 1.0', messageSize: '12 B', flowControl: 'default' }, 112_196],
      [{ nodes: 1, queueType: 'stream', protocol: 'AMQP 0.9.1', messageSize: '12 B', flowControl: 'default' }, 88_912],
    ],
  ).map((f) =>
    f.when.flowControl === 'raised'
      ? { ...f, conditions: [...f.conditions, RAISED] }
      : f.when.queueType === 'quorum'
        ? {
            ...f,
            conditions: [...f.conditions, 'each fsync took 5.9 ms on average: the page puts the gap down to the disk'],
          }
        : f,
  ),
}

const valkeyDef: CatalogComponent = {
  id: 'valkey',
  name: 'Valkey',
  about: 'An in-memory key-value store, Redis-compatible.',
  kind: 'cache',
  box: 'node',
  tags: ['Redis', 'Redis-compatible', 'cache', 'key-value'],
  versionMatters: true,
  conditions: {
    operation: { label: 'operation', doc: 'The command measured: SET or GET.' },
    valueSize: { label: 'value size', doc: 'The size of each value.' },
    ioThreads: { label: 'io-threads', doc: 'The io-threads setting: the main thread and the I/O threads.' },
  },
  figures: [
    {
      id: 'set-8.0',
      measure: 'capacity',
      value: 1_190_000,
      unit: 'req/s',
      what: 'SET requests',
      scope: 'for one node',
      when: { operation: 'SET', valueSize: '512 B', ioThreads: 9 },
      conditions: [
        'AWS c7g.4xlarge (16 Arm cores), no RDB saves, the main thread pinned',
        'valkey-benchmark -t set -d 512 -r 3000000 -c 650 --threads 50, from another instance',
      ],
      versions: ['8.0'],
      source: {
        title: 'Unlock 1 Million RPS: Experience Triple the Speed with Valkey - part 2',
        url: 'https://valkey.io/blog/unlock-one-million-rps-part2/',
        by: 'the Valkey project',
        date: '2024-09-13',
        checked: CHECKED,
      },
    },
  ],
}

const etcdPerf: Source = {
  title: 'etcd: Performance',
  url: 'https://etcd.io/docs/v3.6/op-guide/performance/',
  by: 'the etcd project',
  date: '2023-04-17',
  checked: CHECKED,
}
const etcdBase = {
  unit: 'ops/s',
  scope: 'for the whole cluster',
  versions: ['3.2'],
  source: etcdPerf,
} as const
const etcdRun = [
  'members of 8 vCPU, 16 GB, 50 GB SSD on Google Cloud, a client machine of 16 vCPU',
  'keys of 8 B, values of 256 B, the etcd benchmark tool, Go 1.8.3',
]

const etcdDef: CatalogComponent = {
  id: 'etcd',
  name: 'etcd',
  about: 'A consistent key-value store for configuration and coordination.',
  kind: 'store',
  box: 'cluster',
  tags: ['key-value', 'Raft', 'coordination'],
  versionMatters: false,
  conditions: {
    members: { label: 'members', doc: 'Members in the cluster.', unit: 'members' },
    operation: { label: 'operation', doc: 'write, or read.' },
    clients: { label: 'clients', doc: 'Clients at once.', unit: 'clients' },
    target: { label: 'writes to', doc: 'leader (every write sent to the leader) or all members.' },
    consistency: { label: 'reads', doc: 'linearizable or serializable.' },
  },
  figures: [
    ...rows(
      { ...etcdBase, measure: 'capacity', what: 'writes', conditions: etcdRun },
      (w) => `write-${w.clients}-${String(w.target).replace(' ', '-')}`,
      [
        [{ members: 3, operation: 'write', clients: 1, target: 'leader' }, 583],
        [{ members: 3, operation: 'write', clients: 1000, target: 'leader' }, 44_341],
        [{ members: 3, operation: 'write', clients: 1000, target: 'all members' }, 50_104],
      ],
    ),
    ...rows(
      { ...etcdBase, measure: 'capacity', what: 'reads', conditions: etcdRun },
      (w) => `read-${w.clients}-${w.consistency}`,
      [
        [{ members: 3, operation: 'read', clients: 1, consistency: 'linearizable' }, 1_353],
        [{ members: 3, operation: 'read', clients: 1, consistency: 'serializable' }, 2_909],
        [{ members: 3, operation: 'read', clients: 1000, consistency: 'linearizable' }, 141_578],
        [{ members: 3, operation: 'read', clients: 1000, consistency: 'serializable' }, 185_758],
      ],
    ),
  ],
}

const cockroachdbDef: CatalogComponent = {
  id: 'cockroachdb',
  name: 'CockroachDB',
  about: 'A distributed SQL database.',
  kind: 'database',
  box: 'cluster',
  shape: 'cylinder',
  tags: ['SQL', 'PostgreSQL-compatible', 'distributed'],
  versionMatters: true,
  conditions: {
    nodes: { label: 'nodes', doc: 'Nodes in the cluster.', unit: 'nodes' },
    warehouses: { label: 'TPC-C warehouses', doc: 'The size of the TPC-C dataset.', unit: 'warehouses' },
  },
  figures: [
    {
      id: 'tpcc-140k',
      measure: 'capacity',
      value: 1_684_437,
      unit: 'tpmC',
      what: 'TPC-C new orders per minute, 95.45 % efficiency',
      scope: 'for the whole cluster',
      when: { nodes: 81, warehouses: 140_000 },
      conditions: [
        'nodes of AWS c5d.9xlarge, 5 workload machines',
        '11.2 TB, SERIALIZABLE isolation',
        'cockroach workload tpcc',
      ],
      versions: ['21.1'],
      source: {
        title: 'CockroachDB: Performance',
        url: 'https://docs.cockroachlabs.com/docs/v25.4/performance',
        by: 'Cockroach Labs',
        checked: CHECKED,
      },
    },
  ],
}

const clickhouseDef: CatalogComponent = {
  id: 'clickhouse',
  name: 'ClickHouse',
  about: 'A column-oriented database for analytics.',
  kind: 'analytics',
  box: 'node',
  shape: 'cylinder',
  tags: ['OLAP', 'SQL', 'analytics'],
  versionMatters: false,
  conditions: {
    vcpus: { label: 'vCPUs', doc: 'vCPUs of the instance.', unit: 'vCPUs' },
    workload: { label: 'workload', doc: 'The query mix: ClickBench (43 analytic queries on 100 million rows).' },
  },
  figures: [
    {
      id: 'clickbench-concurrent',
      measure: 'capacity',
      value: 1.615,
      unit: 'queries/s',
      what: 'analytic queries over 10 connections for 600 s, none failed',
      scope: 'for one instance',
      when: { vcpus: 16, workload: 'ClickBench' },
      conditions: [
        'AWS c6a.4xlarge (16 vCPU, 32 GB), 500 GB gp2, untuned',
        'the hits table: about 100 million rows, 9.5 GB stored',
        'ClickBench says its main sweep does not test system capacity: this is its supplementary concurrent test',
      ],
      versions: ['the release served on 2026-11-09'],
      source: {
        title: 'ClickBench: ClickHouse on c6a.4xlarge',
        url: 'https://github.com/ClickHouse/ClickBench/blob/main/clickhouse/results/20261109/c6a.4xlarge.json',
        by: 'ClickHouse',
        date: '2026-11-09',
        checked: CHECKED,
      },
    },
  ],
}

const opensearchDef: CatalogComponent = {
  id: 'opensearch',
  name: 'OpenSearch',
  about: 'A search and analytics engine, Elasticsearch-compatible.',
  kind: 'search',
  box: 'cluster',
  tags: ['Elasticsearch', 'Elasticsearch-compatible', 'search'],
  versionMatters: true,
  conditions: {
    nodes: { label: 'nodes', doc: 'Nodes in the cluster.', unit: 'nodes' },
    workload: { label: 'workload', doc: 'The benchmark workload: Big5.' },
  },
  figures: [
    {
      id: 'big5-text-queries',
      measure: 'latency',
      value: 6.39,
      unit: 'ms',
      what: 'mean latency of text queries',
      scope: 'for one node',
      when: { nodes: 1, workload: 'Big5' },
      conditions: [
        'AWS c5.2xlarge (8 vCPU, 16 GB), 8 GB heap, 1 primary shard, no replicas',
        'Big5: about 100 GB, 116 million documents; throughput throttled, the mean of 3 runs after warm-up',
      ],
      versions: ['3.3'],
      source: {
        title: 'OpenSearch 3.3: Performance innovations for AI search solutions',
        url: 'https://opensearch.org/blog/opensearch-3-3-performance-innovations-for-ai-search-solutions/',
        by: 'the OpenSearch project',
        date: '2025-12-08',
        checked: CHECKED,
      },
    },
  ],
}

const nginxRun = [
  '2 × Intel Xeon E5-2699 v3 2.3 GHz (36 cores, hyper-threading off), 2 × 40 GbE, 16 GB',
  'a worker process per CPU, wrk 4.0.0 with 50 connections, Ubuntu 14.04.1',
]
const nginxTls = 'OpenSSL 1.0.1f, ECDHE-RSA-AES256-GCM-SHA384, 2048-bit RSA key'
const nginxBase = {
  measure: 'capacity',
  scope: 'for one instance',
  versions: ['1.9.7'],
  source: {
    title: 'Testing the Performance of NGINX and NGINX Plus Web Servers',
    url: 'https://blog.nginx.org/blog/testing-the-performance-of-nginx-and-nginx-plus-web-servers',
    by: 'NGINX (F5)',
    date: '2017-08-24',
    checked: CHECKED,
  },
} as const
const CPUS = [1, 2, 4, 8, 16, 32, 36] as const
const SIZES = ['0 KB', '1 KB', '10 KB', '100 KB'] as const
/** A table of requests per second: a row per CPU count, a column per response size. */
const rpsTable = (traffic: 'HTTP' | 'HTTPS', table: readonly (readonly number[])[]) =>
  rows(
    {
      ...nginxBase,
      unit: 'req/s',
      what: `${traffic} requests`,
      conditions: traffic === 'HTTPS' ? [...nginxRun, nginxTls] : nginxRun,
    },
    (w) => `${traffic.toLowerCase()}-${w.cpus}cpu-${String(w.responseSize).replace(' ', '').toLowerCase()}`,
    CPUS.flatMap((cpus, i) =>
      SIZES.map((responseSize, j) => [{ cpus, traffic, responseSize }, table[i]![j]!] as const),
    ),
  )
const cpsTable = (
  traffic: 'new HTTP connections' | 'new HTTPS connections',
  cpus: readonly number[],
  values: readonly number[],
) =>
  rows(
    {
      ...nginxBase,
      unit: 'conn/s',
      what: `${traffic}, one request each with an empty response, closed after it`,
      conditions: traffic === 'new HTTPS connections' ? [...nginxRun, nginxTls] : nginxRun,
    },
    (w) => `${traffic === 'new HTTP connections' ? 'cps' : 'tls-cps'}-${w.cpus}cpu`,
    cpus.map((n, i) => [{ cpus: n, traffic }, values[i]!] as const),
  )

const nginxDef: CatalogComponent = {
  id: 'nginx',
  name: 'NGINX',
  about: 'A web server and reverse proxy.',
  kind: 'proxy',
  box: 'node',
  tags: ['web server', 'reverse proxy', 'load balancer'],
  versionMatters: false,
  conditions: {
    cpus: { label: 'CPUs', doc: 'CPUs given to NGINX: one worker process each.', unit: 'CPUs' },
    traffic: { label: 'traffic', doc: 'HTTP or HTTPS requests, or new HTTP or HTTPS connections.' },
    responseSize: { label: 'response size', doc: 'The size of each response, for requests.' },
  },
  figures: [
    ...rpsTable('HTTP', [
      [145_551, 74_091, 54_684, 33_125],
      [249_293, 131_466, 102_069, 62_554],
      [543_061, 261_269, 207_848, 88_691],
      [1_048_421, 524_745, 392_151, 91_640],
      [2_001_846, 972_382, 663_921, 91_623],
      [3_019_182, 1_316_362, 774_567, 91_640],
      [3_298_511, 1_309_358, 764_744, 91_655],
    ]),
    ...rpsTable('HTTPS', [
      [71_561, 40_207, 23_308, 4_830],
      [151_325, 85_139, 48_654, 9_871],
      [324_654, 178_395, 96_808, 19_355],
      [647_213, 359_576, 198_818, 38_900],
      [1_262_999, 690_329, 383_860, 77_427],
      [2_197_336, 1_207_959, 692_804, 90_430],
      [2_175_945, 1_239_624, 733_745, 89_842],
    ]),
    ...cpsTable('new HTTP connections', CPUS, [34_344, 54_368, 123_164, 194_967, 255_032, 261_033, 257_277]),
    ...cpsTable('new HTTPS connections', [1, 2, 4, 8, 16, 24, 36], [428, 869, 1_735, 3_399, 6_676, 10_274, 10_067]),
  ],
}

const haproxyDef: CatalogComponent = {
  id: 'haproxy',
  name: 'HAProxy',
  about: 'A load balancer and reverse proxy.',
  kind: 'proxy',
  box: 'node',
  tags: ['load balancer', 'reverse proxy'],
  versionMatters: false,
  conditions: {
    cores: { label: 'cores', doc: 'Cores HAProxy runs on.', unit: 'cores' },
    traffic: { label: 'traffic', doc: 'HTTP or HTTPS.' },
  },
  figures: [
    {
      id: 'http-46cores',
      measure: 'capacity',
      value: 2_040_000,
      unit: 'req/s',
      what: 'HTTP requests forwarded (2.04 to 2.05 million)',
      scope: 'for one instance',
      when: { cores: 46, traffic: 'HTTP' },
      conditions: [
        'AWS c6gn.16xlarge (64 Graviton2 cores, 100 Gbps) for the clients, HAProxy and the servers alike; network interrupts on 16 other cores',
        'h1load with 46 threads and 1,150 connections, empty responses, 120 s; p99.9 latency 5 ms',
      ],
      versions: ['2.3.7'],
      source: {
        title: 'HAProxy Forwards Over 2 Million HTTP Requests per Second on a Single Arm-based AWS Graviton2 Instance',
        url: 'https://www.haproxy.com/blog/haproxy-forwards-over-2-million-http-requests-per-second-on-a-single-aws-arm-instance',
        by: 'HAProxy Technologies',
        date: '2021-04-08',
        checked: CHECKED,
      },
    },
  ],
}

const corednsDef: CatalogComponent = {
  id: 'coredns',
  name: 'CoreDNS',
  about: 'A DNS server, the default in Kubernetes.',
  kind: 'dns',
  box: 'node',
  tags: ['DNS', 'Kubernetes'],
  versionMatters: false,
  conditions: {
    vcpus: { label: 'vCPUs', doc: 'vCPUs of the instance.', unit: 'vCPUs' },
    names: { label: 'names', doc: 'cluster (names inside the cluster) or external.' },
    autopath: { label: 'autopath', doc: 'The autopath plugin, which saves the search-path lookups.' },
  },
  figures: rows(
    {
      measure: 'capacity',
      unit: 'queries/s',
      what: 'DNS queries',
      scope: 'for one instance',
      conditions: [
        'GCE n1-standard-2 (2 vCPU), both CPUs busy',
        'Kubernetes 1.13.0-alpha.2, dnsperf from kubernetes/perf-tests',
        'an external name takes 5 lookups through the search path without autopath',
      ],
      versions: ['1.2.5'],
      source: {
        title: 'Scaling CoreDNS in Kubernetes Clusters',
        url: 'https://github.com/coredns/deployment/blob/master/kubernetes/Scaling_CoreDNS.md',
        by: 'the CoreDNS project',
        checked: CHECKED,
      },
    },
    (w) => `${w.names}-names${w.autopath ? '-autopath' : ''}`,
    [
      [{ vcpus: 2, names: 'cluster', autopath: false }, 33_669],
      [{ vcpus: 2, names: 'external', autopath: false }, 6_733],
      [{ vcpus: 2, names: 'cluster', autopath: true }, 33_918],
      [{ vcpus: 2, names: 'external', autopath: true }, 31_428],
    ],
  ),
}

const k8sLimit = (id: string, value: number, unit: string, what: string, scope: string): Figure => ({
  id,
  measure: 'limit',
  value,
  unit,
  what,
  scope,
  when: {},
  conditions: ['the most the project supports with its scalability SLOs met'],
  versions: ['1.37'],
  source: {
    title: 'Considerations for large clusters',
    url: 'https://kubernetes.io/docs/setup/best-practices/cluster-large/',
    by: 'the Kubernetes project',
    date: '2026-02-08',
    checked: CHECKED,
  },
})

const kubernetesDef: CatalogComponent = {
  id: 'kubernetes',
  name: 'Kubernetes',
  about: 'A container orchestrator: its control plane and the nodes it schedules on.',
  kind: 'platform',
  box: 'cluster',
  tags: ['k8s', 'orchestrator', 'control plane'],
  versionMatters: false,
  conditions: {},
  figures: [
    k8sLimit('nodes', 5000, 'nodes', 'nodes in a cluster', 'for the whole cluster'),
    k8sLimit('pods', 150_000, 'pods', 'pods in a cluster', 'for the whole cluster'),
    k8sLimit('containers', 300_000, 'containers', 'containers in a cluster', 'for the whole cluster'),
    k8sLimit('pods-per-node', 110, 'pods', 'pods on one node', 'per node'),
  ],
}

const istioDef: CatalogComponent = {
  id: 'istio',
  name: 'Istio',
  about: 'A service mesh: a proxy beside or in front of every workload.',
  kind: 'mesh',
  box: 'pool',
  tags: ['service mesh', 'Envoy', 'sidecar'],
  versionMatters: true,
  conditions: {
    proxy: { label: 'proxy', doc: 'sidecar, waypoint or ztunnel.' },
  },
  figures: rows(
    {
      measure: 'cost',
      unit: 'vCPU per 1,000 req/s',
      what: 'CPU of the proxy',
      scope: 'per proxy',
      conditions: [
        '1,000 HTTP requests/s of 1 KB, 2 worker threads (the ztunnel aside)',
        'a load-test mesh of 1,000 services and 2,000 pods',
      ],
      versions: ['1.24'],
      source: {
        title: 'Istio: Performance and Scalability',
        url: 'https://istio.io/latest/docs/ops/deployment/performance-and-scalability/',
        by: 'the Istio project',
        checked: CHECKED,
      },
    },
    (w) => `${w.proxy}-cpu`,
    [
      [{ proxy: 'sidecar' }, 0.2],
      [{ proxy: 'waypoint' }, 0.25],
      [{ proxy: 'ztunnel' }, 0.06],
    ],
  ),
}

/** Popular, but nothing is published with its conditions: always "no published benchmark". */
const unpublished = (
  id: string,
  name: string,
  about: string,
  kind: CatalogComponent['kind'],
  box: CatalogComponent['box'],
  tags: readonly string[],
  shape?: 'cylinder',
): CatalogComponent => ({
  id,
  name,
  about,
  kind,
  box,
  ...(shape && { shape }),
  tags,
  versionMatters: false,
  conditions: {},
  figures: [],
})

const COMPONENTS: readonly CatalogComponent[] = [
  kafkaDef,
  rabbitmqDef,
  valkeyDef,
  etcdDef,
  cockroachdbDef,
  clickhouseDef,
  opensearchDef,
  nginxDef,
  haproxyDef,
  corednsDef,
  kubernetesDef,
  istioDef,
  unpublished(
    'postgresql',
    'PostgreSQL',
    'A relational database.',
    'database',
    'node',
    ['SQL', 'Postgres'],
    'cylinder',
  ),
  unpublished('mysql', 'MySQL', 'A relational database.', 'database', 'node', ['SQL', 'MariaDB'], 'cylinder'),
  unpublished('mongodb', 'MongoDB', 'A document database.', 'database', 'cluster', ['NoSQL', 'documents'], 'cylinder'),
  unpublished('envoy', 'Envoy', 'A proxy for services and the edge.', 'proxy', 'node', ['proxy', 'load balancer']),
]

/** Frozen all the way down: a released edition cannot change under a page that uses it. */
const frozen = <T>(o: T): T => {
  if (o && typeof o === 'object' && !Object.isFrozen(o)) {
    for (const v of Object.values(o)) frozen(v)
    Object.freeze(o)
  }
  return o
}

const edition = (name: string, list: readonly CatalogComponent[]): Catalog =>
  frozen({
    edition: name,
    components: Object.fromEntries(list.map((c) => [c.id, { ...c, edition: name } as Published])),
  })

/** Every edition, oldest first: a definition names the one it was written against. */
export const EDITIONS: Readonly<Record<string, Catalog>> = Object.freeze({ '2026-11': edition('2026-11', COMPONENTS) })

/** The latest edition. */
export const CATALOG: Catalog = EDITIONS['2026-11']!

const latest = (id: string) => CATALOG.components[id]!

// one export per component, of the latest edition: `published(kafka, { … })`
export const kafka: Published = latest('kafka')
export const rabbitmq: Published = latest('rabbitmq')
export const valkey: Published = latest('valkey')
export const etcd: Published = latest('etcd')
export const cockroachdb: Published = latest('cockroachdb')
export const clickhouse: Published = latest('clickhouse')
export const opensearch: Published = latest('opensearch')
export const nginx: Published = latest('nginx')
export const haproxy: Published = latest('haproxy')
export const coredns: Published = latest('coredns')
export const kubernetes: Published = latest('kubernetes')
export const istio: Published = latest('istio')
export const postgresql: Published = latest('postgresql')
export const mysql: Published = latest('mysql')
export const mongodb: Published = latest('mongodb')
export const envoy: Published = latest('envoy')
