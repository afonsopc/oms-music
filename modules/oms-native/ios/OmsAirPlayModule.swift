// OmsAirPlayModule - AirPlay para o leitor (src/cast).
//
// O AVPlayer do expo-audio já pode sair por AirPlay (allowsExternalPlayback
// fica no valor por omissão, true) e a sessão de áudio é .playback, por
// isso o som, o Now Playing e os comandos do ecrã bloqueado seguem para a
// coluna/TV sem mais nada. Faltava a escolha da saída dentro da app e saber
// qual é: o AVRoutePickerView (a lista do sistema) e a rota actual do
// AVAudioSession, com um evento quando muda.
import AVFoundation
import AVKit
import ExpoModulesCore

private let routeChangedEvent = "routeChanged"

private func currentRouteInfo() -> [String: Any] {
  let outputs = AVAudioSession.sharedInstance().currentRoute.outputs
  if let port = outputs.first(where: { $0.portType == .airPlay }) {
    return ["kind": "airplay", "name": port.portName]
  }
  let bluetooth: [AVAudioSession.Port] = [.bluetoothA2DP, .bluetoothLE, .bluetoothHFP]
  if let port = outputs.first(where: { bluetooth.contains($0.portType) }) {
    return ["kind": "bluetooth", "name": port.portName]
  }
  if let port = outputs.first(where: { $0.portType == .HDMI || $0.portType == .carAudio }) {
    return ["kind": "other", "name": port.portName]
  }
  return ["kind": "local", "name": outputs.first?.portName ?? ""]
}

public final class OmsAirPlayModule: Module {
  private var observer: NSObjectProtocol?

  public func definition() -> ModuleDefinition {
    Name("OmsAirPlay")

    Events(routeChangedEvent)

    OnStartObserving {
      if self.observer != nil { return }
      self.observer = NotificationCenter.default.addObserver(
        forName: AVAudioSession.routeChangeNotification,
        object: nil,
        queue: .main
      ) { [weak self] _ in
        self?.sendEvent(routeChangedEvent, currentRouteInfo())
      }
    }

    OnStopObserving {
      if let observer = self.observer {
        NotificationCenter.default.removeObserver(observer)
        self.observer = nil
      }
    }

    Function("currentRoute") { () -> [String: Any] in
      return currentRouteInfo()
    }

    // Transparente por omissão: a JS põe-no por cima da linha "AirPlay" da
    // lista Transmitir, e tocar em qualquer sítio da linha abre o sistema.
    View(OmsRoutePickerView.self) {
      Prop("tint") { (view: OmsRoutePickerView, color: UIColor?) in
        view.picker.tintColor = color ?? .clear
      }
      Prop("activeTint") { (view: OmsRoutePickerView, color: UIColor?) in
        view.picker.activeTintColor = color ?? .clear
      }
    }
  }
}

public final class OmsRoutePickerView: ExpoView {
  let picker = AVRoutePickerView()

  public required init(appContext: AppContext? = nil) {
    super.init(appContext: appContext)
    picker.prioritizesVideoDevices = false
    picker.backgroundColor = .clear
    picker.tintColor = .clear
    picker.activeTintColor = .clear
    addSubview(picker)
  }

  public override func layoutSubviews() {
    super.layoutSubviews()
    picker.frame = bounds
    // O botão de dentro do AVRoutePickerView tem o tamanho do ícone; esticá-lo
    // à linha toda para o toque apanhar em qualquer sítio.
    for sub in picker.subviews {
      sub.frame = picker.bounds
    }
  }
}
