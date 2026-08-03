Pod::Spec.new do |s|
  s.name           = 'OmsNative'
  s.version        = '1.0.0'
  s.summary        = 'Lock-screen track commands, backup exclusion and the stem mixer for oms-music.'
  s.description    = 'Local Expo module: additive MPRemoteCommandCenter next/previous handlers (FR-63), isExcludedFromBackup on the downloads directory (FR-84) and the custom-blend stem mixer (FR-69/FR-70) - one AVAudioEngine, two AVAudioPlayerNodes on a shared render clock, per-stem gains and a 3-band AVAudioUnitEQ.'
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
