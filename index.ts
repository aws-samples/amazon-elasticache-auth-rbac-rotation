import cdk = require('@aws-cdk/core');
import ec2 = require('@aws-cdk/aws-ec2');
import iam = require('@aws-cdk/aws-iam');
import elasticache = require('@aws-cdk/aws-elasticache');
import lambda = require('@aws-cdk/aws-lambda');
import secretsmanager = require('@aws-cdk/aws-secretsmanager')
import path = require('path');
import { RedisRbacRotation, RedisSingleAuthRotation } from './lib/redisRotator';


export class RedisAuthRotationDemo extends cdk.Stack {
  constructor(scope: cdk.App, id: string, props?: cdk.StackProps) {
    super(scope, id, props);

    const clusterId = 'redisDemoCluster'

    const vpc = new ec2.Vpc(this, "Vpc", {
      subnetConfiguration: [
        {
          cidrMask: 24,
          name: 'Isolated',
          subnetType: ec2.SubnetType.ISOLATED,
        },
        {
          cidrMask: 24,
          name: 'Private',
          subnetType: ec2.SubnetType.PRIVATE,
        },
        {
          cidrMask: 24,
          name: 'Public',
          subnetType: ec2.SubnetType.PUBLIC,
        },
      ]
    });

    const secretsManagerEndpoint = vpc.addInterfaceEndpoint('SecretsManagerEndpoint', {
      service: ec2.InterfaceVpcEndpointAwsService.SECRETS_MANAGER,
      subnets: {
        subnetType: ec2.SubnetType.ISOLATED,

      }
    });

    secretsManagerEndpoint.connections.allowDefaultPortFromAnyIpv4();


    const ecSecurityGroup = new ec2.SecurityGroup(this, 'ElastiCacheSG', {
      vpc: vpc,
      description: 'SecurityGroup associated with the ElastiCache Redis Cluster'
    });

    ecSecurityGroup.addIngressRule(ec2.Peer.anyIpv4(), ec2.Port.tcp(6379), 'Redis ingress 6379')

    const rotatorSecurityGroup = new ec2.SecurityGroup(this, 'RotatorSG', {
      vpc: vpc,
      description: 'SecurityGroup for rotator function'
    });

    rotatorSecurityGroup.addIngressRule(ec2.Peer.anyIpv4(), ec2.Port.allTraffic(), 'All port inbound')

    let isolatedSubnets: string[] = []

    vpc.isolatedSubnets.forEach(function(value){
      isolatedSubnets.push(value.subnetId)
    });

    const ecSubnetGroup = new elasticache.CfnSubnetGroup(this, 'ElastiCacheSubnetGroup', {
      description: 'Elasticache Subnet Group',
      subnetIds: isolatedSubnets
    });

    const redisSingleAuth = new RedisSingleAuthRotation(this, 'SingleAuth', {
      replicationGroupId: 'redisSingleAuthDemo',
      elasticacheSubnetGroup: ecSubnetGroup,
      elasticacheSecurityGroupIds: [ecSecurityGroup.securityGroupId],
      rotatorFunctionSecurityGroups: [ecSecurityGroup, rotatorSecurityGroup],
      rotationSchedule: cdk.Duration.days(15),
      rotatorVpc: vpc
    })

  }
}

const app = new cdk.App();
new RedisAuthRotationDemo(app, 'RedisSecretRotationDemo');
app.synth();