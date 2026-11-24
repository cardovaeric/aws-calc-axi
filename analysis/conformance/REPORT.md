# P0 conformance matrix

Generated: 2026-11-24T10:20:27.847Z

Cases: 1892. Batches: 198 (max 10 rows per link).

| Service | Cases | Editor-verified | Failed | Blocked | Pending |
| --- | ---: | ---: | ---: | ---: | ---: |
| amazonElasticBlockStore | 178 | 0 | 0 | 40 | 138 |
| amazonRDSForSQLServer | 120 | 0 | 0 | 120 | 0 |
| amazonRDSMariaDB | 116 | 0 | 0 | 116 | 0 |
| amazonRDSMySQLDB | 154 | 0 | 0 | 154 | 0 |
| amazonRDSPostgreSQLDB | 154 | 0 | 0 | 154 | 0 |
| amazonRdsForDb2 | 24 | 0 | 0 | 24 | 0 |
| amazonRdsForOracle | 86 | 0 | 0 | 86 | 0 |
| awsEks | 64 | 0 | 0 | 20 | 44 |
| awsPrivateLinkVpc | 30 | 0 | 0 | 0 | 30 |
| cloudWan | 16 | 0 | 0 | 0 | 16 |
| dataTransferVpc | 2 | 0 | 0 | 0 | 2 |
| eC2Next | 272 | 0 | 0 | 272 | 0 |
| ec2Enhancement | 510 | 0 | 0 | 510 | 0 |
| gatewayLoadBalancerVpc | 18 | 0 | 0 | 0 | 18 |
| ipamVpc | 8 | 0 | 0 | 8 | 0 |
| networkAccessAnalyzerVpc | 14 | 0 | 0 | 14 | 0 |
| networkAddressTranslationNatGatewayVpc | 26 | 0 | 0 | 26 | 0 |
| publicIpv4Address | 14 | 0 | 0 | 0 | 14 |
| reachabilityAnalyzerVpc | 8 | 0 | 0 | 8 | 0 |
| trafficMirroringVpc | 8 | 0 | 0 | 8 | 0 |
| transitGatewayVpc | 18 | 0 | 0 | 0 | 18 |
| vpcRouteServer | 8 | 0 | 0 | 8 | 0 |
| vpnConnectionVpc | 26 | 0 | 0 | 0 | 26 |
| windowsWorkloads | 18 | 0 | 0 | 18 | 0 |

## Blocked services

| Service | Reason | Enumerated cases |
| --- | --- | ---: |
| ec2Enhancement | ec2PriceFetcher not implemented | 510 |
| eC2Next | ec2PriceFetcher not implemented | 272 |
| windowsWorkloads | 25 bespoke subtypes | 18 |
| amazonRDSMySQLDB | column-form v2 | 154 |
| amazonRDSPostgreSQLDB | column-form v2 | 154 |
| amazonRDSMariaDB | column-form v2 | 116 |
| amazonRDSForSQLServer | column-form v2 | 120 |
| amazonRdsForOracle | column-form v2 | 86 |
| amazonRdsForDb2 | column-form v2 | 24 |

## Batches

| Batch | Cases | Status | Monthly | Link |
| --- | ---: | --- | ---: | --- |
| awsEks-001 | 10 | native-error | - | - |
| awsEks-002 | 10 | pending | 9070254805.3 | - |
| awsEks-003 | 10 | pending | 3741372558.44 | - |
| awsEks-004 | 10 | native-error | - | - |
| awsEks-005 | 10 | pending | 27716644746.52 | - |
| awsEks-006 | 10 | pending | 5006377238.34 | - |
| awsEks-007 | 4 | pending | 380041.28 | - |
| amazonElasticBlockStore-001 | 10 | pending | 13480880834.12 | - |
| amazonElasticBlockStore-002 | 10 | pending | 5661.27 | - |
| amazonElasticBlockStore-003 | 10 | pending | 6110.22 | - |
| amazonElasticBlockStore-004 | 10 | pending | 7284.99 | - |
| amazonElasticBlockStore-005 | 10 | pending | 5784.72 | - |
| amazonElasticBlockStore-006 | 10 | pending | 5640.72 | - |
| amazonElasticBlockStore-007 | 10 | native-error | - | - |
| amazonElasticBlockStore-008 | 10 | native-error | - | - |
| amazonElasticBlockStore-009 | 10 | pending | 5635.88 | - |
| amazonElasticBlockStore-010 | 10 | pending | 13480880884.3 | - |
| amazonElasticBlockStore-011 | 10 | pending | 5612.77 | - |
| amazonElasticBlockStore-012 | 10 | pending | 6215.91 | - |
| amazonElasticBlockStore-013 | 10 | pending | 7368.95 | - |
| amazonElasticBlockStore-014 | 10 | pending | 5641.02 | - |
| amazonElasticBlockStore-015 | 10 | pending | 5593.87 | - |
| amazonElasticBlockStore-016 | 10 | native-error | - | - |
| amazonElasticBlockStore-017 | 10 | native-error | - | - |
| amazonElasticBlockStore-018 | 8 | pending | 4500.83 | - |
| vpnConnectionVpc-001 | 10 | pending | 54752253.12 | - |
| vpnConnectionVpc-002 | 10 | pending | 54751899.53 | - |
| vpnConnectionVpc-003 | 6 | pending | 1577.83 | - |
| networkAccessAnalyzerVpc-001 | 10 | native-error | - | - |
| networkAccessAnalyzerVpc-002 | 4 | native-error | - | - |
| reachabilityAnalyzerVpc-001 | 8 | native-error | - | - |
| trafficMirroringVpc-001 | 8 | native-error | - | - |
| publicIpv4Address-001 | 10 | pending | 12775043.8 | - |
| publicIpv4Address-002 | 4 | pending | 9125014.6 | - |
| ipamVpc-001 | 8 | native-error | - | - |
| dataTransferVpc-001 | 2 | pending | 0 | - |
| vpcRouteServer-001 | 8 | native-error | - | - |
| networkAddressTranslationNatGatewayVpc-001 | 10 | native-error | - | - |
| networkAddressTranslationNatGatewayVpc-002 | 10 | native-error | - | - |
| networkAddressTranslationNatGatewayVpc-003 | 6 | native-error | - | - |
| transitGatewayVpc-001 | 10 | pending | 607500004375.5 | - |
| transitGatewayVpc-002 | 8 | pending | 607500004294.5 | - |
| awsPrivateLinkVpc-001 | 10 | pending | 219000435171.66 | - |
| awsPrivateLinkVpc-002 | 10 | pending | 109500000053.8 | - |
| awsPrivateLinkVpc-003 | 10 | pending | 109500435200.86 | - |
| gatewayLoadBalancerVpc-001 | 10 | pending | 74477660.4 | - |
| gatewayLoadBalancerVpc-002 | 8 | pending | 74476532.54 | - |
| cloudWan-001 | 10 | pending | 1423500005503.95 | - |
| cloudWan-002 | 6 | pending | 1423500004580.15 | - |
| ec2Enhancement-001 | 10 | native-error | - | - |
| ec2Enhancement-002 | 10 | native-error | - | - |
| ec2Enhancement-003 | 10 | native-error | - | - |
| ec2Enhancement-004 | 10 | native-error | - | - |
| ec2Enhancement-005 | 10 | native-error | - | - |
| ec2Enhancement-006 | 10 | native-error | - | - |
| ec2Enhancement-007 | 10 | native-error | - | - |
| ec2Enhancement-008 | 10 | native-error | - | - |
| ec2Enhancement-009 | 10 | native-error | - | - |
| ec2Enhancement-010 | 10 | native-error | - | - |
| ec2Enhancement-011 | 10 | native-error | - | - |
| ec2Enhancement-012 | 10 | native-error | - | - |
| ec2Enhancement-013 | 10 | native-error | - | - |
| ec2Enhancement-014 | 10 | native-error | - | - |
| ec2Enhancement-015 | 10 | native-error | - | - |
| ec2Enhancement-016 | 10 | native-error | - | - |
| ec2Enhancement-017 | 10 | native-error | - | - |
| ec2Enhancement-018 | 10 | native-error | - | - |
| ec2Enhancement-019 | 10 | native-error | - | - |
| ec2Enhancement-020 | 10 | native-error | - | - |
| ec2Enhancement-021 | 10 | native-error | - | - |
| ec2Enhancement-022 | 10 | native-error | - | - |
| ec2Enhancement-023 | 10 | native-error | - | - |
| ec2Enhancement-024 | 10 | native-error | - | - |
| ec2Enhancement-025 | 10 | native-error | - | - |
| ec2Enhancement-026 | 10 | native-error | - | - |
| ec2Enhancement-027 | 10 | native-error | - | - |
| ec2Enhancement-028 | 10 | native-error | - | - |
| ec2Enhancement-029 | 10 | native-error | - | - |
| ec2Enhancement-030 | 10 | native-error | - | - |
| ec2Enhancement-031 | 10 | native-error | - | - |
| ec2Enhancement-032 | 10 | native-error | - | - |
| ec2Enhancement-033 | 10 | native-error | - | - |
| ec2Enhancement-034 | 10 | native-error | - | - |
| ec2Enhancement-035 | 10 | native-error | - | - |
| ec2Enhancement-036 | 10 | native-error | - | - |
| ec2Enhancement-037 | 10 | native-error | - | - |
| ec2Enhancement-038 | 10 | native-error | - | - |
| ec2Enhancement-039 | 10 | native-error | - | - |
| ec2Enhancement-040 | 10 | native-error | - | - |
| ec2Enhancement-041 | 10 | native-error | - | - |
| ec2Enhancement-042 | 10 | native-error | - | - |
| ec2Enhancement-043 | 10 | native-error | - | - |
| ec2Enhancement-044 | 10 | native-error | - | - |
| ec2Enhancement-045 | 10 | native-error | - | - |
| ec2Enhancement-046 | 10 | native-error | - | - |
| ec2Enhancement-047 | 10 | native-error | - | - |
| ec2Enhancement-048 | 10 | native-error | - | - |
| ec2Enhancement-049 | 10 | native-error | - | - |
| ec2Enhancement-050 | 10 | native-error | - | - |
| ec2Enhancement-051 | 10 | native-error | - | - |
| eC2Next-001 | 10 | native-error | - | - |
| eC2Next-002 | 10 | native-error | - | - |
| eC2Next-003 | 10 | native-error | - | - |
| eC2Next-004 | 10 | native-error | - | - |
| eC2Next-005 | 10 | native-error | - | - |
| eC2Next-006 | 10 | native-error | - | - |
| eC2Next-007 | 10 | native-error | - | - |
| eC2Next-008 | 10 | native-error | - | - |
| eC2Next-009 | 10 | native-error | - | - |
| eC2Next-010 | 10 | native-error | - | - |
| eC2Next-011 | 10 | native-error | - | - |
| eC2Next-012 | 10 | native-error | - | - |
| eC2Next-013 | 10 | native-error | - | - |
| eC2Next-014 | 10 | native-error | - | - |
| eC2Next-015 | 10 | native-error | - | - |
| eC2Next-016 | 10 | native-error | - | - |
| eC2Next-017 | 10 | native-error | - | - |
| eC2Next-018 | 10 | native-error | - | - |
| eC2Next-019 | 10 | native-error | - | - |
| eC2Next-020 | 10 | native-error | - | - |
| eC2Next-021 | 10 | native-error | - | - |
| eC2Next-022 | 10 | native-error | - | - |
| eC2Next-023 | 10 | native-error | - | - |
| eC2Next-024 | 10 | native-error | - | - |
| eC2Next-025 | 10 | native-error | - | - |
| eC2Next-026 | 10 | native-error | - | - |
| eC2Next-027 | 10 | native-error | - | - |
| eC2Next-028 | 2 | native-error | - | - |
| windowsWorkloads-001 | 10 | native-error | - | - |
| windowsWorkloads-002 | 8 | native-error | - | - |
| amazonRDSMySQLDB-001 | 10 | native-error | - | - |
| amazonRDSMySQLDB-002 | 10 | native-error | - | - |
| amazonRDSMySQLDB-003 | 10 | native-error | - | - |
| amazonRDSMySQLDB-004 | 10 | native-error | - | - |
| amazonRDSMySQLDB-005 | 10 | native-error | - | - |
| amazonRDSMySQLDB-006 | 10 | native-error | - | - |
| amazonRDSMySQLDB-007 | 10 | native-error | - | - |
| amazonRDSMySQLDB-008 | 10 | native-error | - | - |
| amazonRDSMySQLDB-009 | 10 | native-error | - | - |
| amazonRDSMySQLDB-010 | 10 | native-error | - | - |
| amazonRDSMySQLDB-011 | 10 | native-error | - | - |
| amazonRDSMySQLDB-012 | 10 | native-error | - | - |
| amazonRDSMySQLDB-013 | 10 | native-error | - | - |
| amazonRDSMySQLDB-014 | 10 | native-error | - | - |
| amazonRDSMySQLDB-015 | 10 | native-error | - | - |
| amazonRDSMySQLDB-016 | 4 | native-error | - | - |
| amazonRDSPostgreSQLDB-001 | 10 | native-error | - | - |
| amazonRDSPostgreSQLDB-002 | 10 | native-error | - | - |
| amazonRDSPostgreSQLDB-003 | 10 | native-error | - | - |
| amazonRDSPostgreSQLDB-004 | 10 | native-error | - | - |
| amazonRDSPostgreSQLDB-005 | 10 | native-error | - | - |
| amazonRDSPostgreSQLDB-006 | 10 | native-error | - | - |
| amazonRDSPostgreSQLDB-007 | 10 | native-error | - | - |
| amazonRDSPostgreSQLDB-008 | 10 | native-error | - | - |
| amazonRDSPostgreSQLDB-009 | 10 | native-error | - | - |
| amazonRDSPostgreSQLDB-010 | 10 | native-error | - | - |
| amazonRDSPostgreSQLDB-011 | 10 | native-error | - | - |
| amazonRDSPostgreSQLDB-012 | 10 | native-error | - | - |
| amazonRDSPostgreSQLDB-013 | 10 | native-error | - | - |
| amazonRDSPostgreSQLDB-014 | 10 | native-error | - | - |
| amazonRDSPostgreSQLDB-015 | 10 | native-error | - | - |
| amazonRDSPostgreSQLDB-016 | 4 | native-error | - | - |
| amazonRDSMariaDB-001 | 10 | native-error | - | - |
| amazonRDSMariaDB-002 | 10 | native-error | - | - |
| amazonRDSMariaDB-003 | 10 | native-error | - | - |
| amazonRDSMariaDB-004 | 10 | native-error | - | - |
| amazonRDSMariaDB-005 | 10 | native-error | - | - |
| amazonRDSMariaDB-006 | 10 | native-error | - | - |
| amazonRDSMariaDB-007 | 10 | native-error | - | - |
| amazonRDSMariaDB-008 | 10 | native-error | - | - |
| amazonRDSMariaDB-009 | 10 | native-error | - | - |
| amazonRDSMariaDB-010 | 10 | native-error | - | - |
| amazonRDSMariaDB-011 | 10 | native-error | - | - |
| amazonRDSMariaDB-012 | 6 | native-error | - | - |
| amazonRDSForSQLServer-001 | 10 | native-error | - | - |
| amazonRDSForSQLServer-002 | 10 | native-error | - | - |
| amazonRDSForSQLServer-003 | 10 | native-error | - | - |
| amazonRDSForSQLServer-004 | 10 | native-error | - | - |
| amazonRDSForSQLServer-005 | 10 | native-error | - | - |
| amazonRDSForSQLServer-006 | 10 | native-error | - | - |
| amazonRDSForSQLServer-007 | 10 | native-error | - | - |
| amazonRDSForSQLServer-008 | 10 | native-error | - | - |
| amazonRDSForSQLServer-009 | 10 | native-error | - | - |
| amazonRDSForSQLServer-010 | 10 | native-error | - | - |
| amazonRDSForSQLServer-011 | 10 | native-error | - | - |
| amazonRDSForSQLServer-012 | 10 | native-error | - | - |
| amazonRdsForOracle-001 | 10 | native-error | - | - |
| amazonRdsForOracle-002 | 10 | native-error | - | - |
| amazonRdsForOracle-003 | 10 | native-error | - | - |
| amazonRdsForOracle-004 | 10 | native-error | - | - |
| amazonRdsForOracle-005 | 10 | native-error | - | - |
| amazonRdsForOracle-006 | 10 | native-error | - | - |
| amazonRdsForOracle-007 | 10 | native-error | - | - |
| amazonRdsForOracle-008 | 10 | native-error | - | - |
| amazonRdsForOracle-009 | 6 | native-error | - | - |
| amazonRdsForDb2-001 | 10 | native-error | - | - |
| amazonRdsForDb2-002 | 10 | native-error | - | - |
| amazonRdsForDb2-003 | 4 | native-error | - | - |
