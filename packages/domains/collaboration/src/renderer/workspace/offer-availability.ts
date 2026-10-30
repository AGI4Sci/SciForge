import type { CollaborationOfferAvailability } from '../../contract.js'

/** One presentation of the backend decision gate across cards, detail and personal lists. */
export function offerAvailabilityPresentation(availability: CollaborationOfferAvailability): Readonly<{ label: string; detail: string }> {
  switch (availability.state) {
    case 'available': return {
      label: '待你接受',
      detail: availability.reason === 'offline_queue_available'
        ? '当前离线。决定会保存在本机，连接恢复后校验派单有效性；同步成功前不会执行。'
        : '接受后，云端会校验并绑定这台电脑；执行条件满足后开始工作。'
    }
    case 'recovering': return { label: '恢复中', detail: '正在重新校验身份和派单，校验完成前不会执行。尚未接受的任务在恢复后仍需你手动接受。' }
    case 'sync_pending': return { label: '待同步', detail: '你的决定已保存在本机，正在核对原请求的云端结果。请等待同步完成。' }
    case 'claimed_elsewhere': return { label: '已被其他设备领取', detail: '此派单已在其他设备领取，这台电脑不会执行。' }
    case 'unverified': return { label: '待核实', detail: '暂未获得可恢复此派单的完整证据。请保持连接以同步最新派单状态。' }
    case 'invalid': return {
      label: '已失效',
      detail: availability.reason === 'offer_expired' ? '派单已到期，请联系负责人重新派发。'
        : availability.reason === 'contract_changed' ? '任务合同已变更，需要新的派单和人工授权。'
          : availability.reason === 'authority_changed' ? '当前账户或设备已无权处理此派单。'
            : '派单已关闭或已由你处理，不能在这台电脑继续接受。'
    }
  }
}
