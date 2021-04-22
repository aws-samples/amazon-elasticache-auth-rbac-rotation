/*
 * Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
 * SPDX-License-Identifier: MIT-0
 *
 * Permission is hereby granted, free of charge, to any person obtaining a copy of this
 * software and associated documentation files (the "Software"), to deal in the Software
 * without restriction, including without limitation the rights to use, copy, modify,
 * merge, publish, distribute, sublicense, and/or sell copies of the Software, and to
 * permit persons to whom the Software is furnished to do so.
 *
 * THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR IMPLIED,
 * INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY, FITNESS FOR A
 * PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE AUTHORS OR COPYRIGHT
 * HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER LIABILITY, WHETHER IN AN ACTION
 * OF CONTRACT, TORT OR OTHERWISE, ARISING FROM, OUT OF OR IN CONNECTION WITH THE
 * SOFTWARE OR THE USE OR OTHER DEALINGS IN THE SOFTWARE.
 */
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

    const vpc = new ec2.Vpc(this, "elasticache-demo-vpc", {
      subnetConfiguration: [

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

    let privateSubnets: string[] = []

    vpc.privateSubnets.forEach(function(value){
      privateSubnets.push(value.subnetId)
    });

    const ecSubnetGroup = new elasticache.CfnSubnetGroup(this, 'ElastiCacheSubnetGroup', {
      description: 'Elasticache Subnet Group',
      subnetIds: privateSubnets
    });



    // const redisSingleAuth = new RedisSingleAuthRotation(this, 'SingleAuth', {
    //   replicationGroupId: 'redisSingleAuthDemo',
    //   elasticacheSubnetGroup: ecSubnetGroup,
    //   elasticacheSecurityGroupIds: [ecSecurityGroup.securityGroupId],
    //   rotatorFunctionSecurityGroups: [ecSecurityGroup, rotatorSecurityGroup],
    //   rotationSchedule: cdk.Duration.days(15),
    //   rotatorVpc: vpc
    // })

    const redisRbac = new RedisRbacRotation(this, 'RbacRotate', {
      replicationGroupId: 'redisRbacRotatorDemo',
      elasticacheSubnetGroupName: ecSubnetGroup.ref,
      elasticacheSecurityGroupIds: [ecSecurityGroup.securityGroupId],
      rotatorFunctionSecurityGroups: [ecSecurityGroup, rotatorSecurityGroup],
      rotationSchedule: cdk.Duration.days(15),
      rotatorVpc: vpc
    })

    redisRbac.node.addDependency(ecSubnetGroup);
    redisRbac.node.addDependency(ecSecurityGroup);
    redisRbac.node.addDependency(vpc);

  }
}

const app = new cdk.App();
new RedisAuthRotationDemo(app, 'RedisSecretRotationDemo');
app.synth();