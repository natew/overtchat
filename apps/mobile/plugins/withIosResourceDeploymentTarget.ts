import type { ConfigPlugin } from 'expo/config-plugins';

const { withPodfile }: typeof import('expo/config-plugins') = require('expo/config-plugins');
const { mergeContents }: typeof import('@expo/config-plugins/build/utils/generateCode') = require('@expo/config-plugins/build/utils/generateCode');

const withIosResourceDeploymentTarget: ConfigPlugin = (config) => withPodfile(config, (mod) => {
  mod.modResults.contents = mergeContents({
    tag: 'ios-resource-deployment-target',
    src: mod.modResults.contents,
    anchor: /post_install do \|installer\|/,
    offset: 1,
    comment: '#',
    newSrc: `
    minimum_ios = [
      Gem::Version.new(podfile_properties.fetch('ios.deploymentTarget')),
      Gem::Version.new(min_ios_version_supported),
    ].max
    installer.pods_project.targets.each do |target|
      next unless target.isa == 'PBXNativeTarget' && target.product_type == 'com.apple.product-type.bundle'
      target.build_configurations.each do |build_configuration|
        deployment_target = build_configuration.build_settings['IPHONEOS_DEPLOYMENT_TARGET']
        if deployment_target && Gem::Version.new(deployment_target) < minimum_ios
          build_configuration.build_settings['IPHONEOS_DEPLOYMENT_TARGET'] = minimum_ios.to_s
        end
      end
    end
`,
  }).contents;
  return mod;
});

module.exports = withIosResourceDeploymentTarget;
