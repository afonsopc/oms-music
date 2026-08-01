Pod::Spec.new do |s|
  s.name           = 'OmsNative'
  s.version        = '1.0.0'
  s.summary        = 'Lock-screen track commands and backup exclusion for oms-music.'
  s.description    = 'Local Expo module: additive MPRemoteCommandCenter next/previous handlers (FR-63) and isExcludedFromBackup on the downloads directory (FR-84).'
  s.author         = 'omelhorsite'
  s.homepage       = 'https://omelhorsite.pt'
  s.license        = { :type => 'MIT' }
  s.platforms      = {
    :ios => '16.4'
  }
  s.swift_version  = '5.9'
  s.source         = { git: '' }
  s.static_framework = true

  s.dependency 'ExpoModulesCore'

  s.source_files = "**/*.{h,m,mm,swift,hpp,cpp}"
  s.pod_target_xcconfig = {
    'DEFINES_MODULE' => 'YES',
    'SWIFT_COMPILATION_MODE' => 'wholemodule'
  }
end
