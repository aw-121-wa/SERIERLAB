/** Observations only: zero samples is not proof of broken hardware. */
export function serialDiagnosis(state: string, rxBytes: number, batches: number, protocol: string): string {
  if (state === 'connecting') return '正在打开串口';
  if (state !== 'connected') return '串口未打开；请检查端口选择、占用和错误信息';
  if (!rxBytes) return '已连接，但本次连接 RX 为 0；检查固件发送、接线和端口';
  if (protocol === 'raw') return '已收到原始数据；RawData 不解析波形';
  if (protocol === 'native') return '已收到串口字节；请结合 Native 握手状态判断协议是否就绪';
  if (!batches) return '已收到字节，但当前协议尚未解析出完整采样；检查波特率、协议和帧格式';
  return '已收到字节并已解析采样';
}
