import { translateWorkspace } from './workspace-i18n.js'
import type { CollaborationOfferAvailability } from '../../contract.js'

/** One presentation of the backend decision gate across cards, detail and personal lists. */
export function offerAvailabilityPresentation(availability: CollaborationOfferAvailability): Readonly<{ label: string; detail: string }> {
  switch (availability.state) {
    case 'available': return {
      label: "待你接受",
      detail: availability.reason === 'offline_queue_available'
        ? translateWorkspace("当前离线。决定会保存在本机，连接恢复后校验派单有效性；同步成功前不会执行。")
        : translateWorkspace("接受后，云端会校验并绑定这台电脑；执行条件满足后开始工作。")
    }
    case 'recovering': return { label: "恢复中", detail: translateWorkspace("正在重新校验身份和派单，校验完成前不会执行。尚未接受的任务在恢复后仍需你手动接受。") }
    case 'sync_pending': return { label: "待同步", detail: translateWorkspace("正在同步这条派单的云端状态与本机记录。核验完成前不会执行，请稍候，无需重复接受或重新派发。") }
    case 'claimed_elsewhere': return { label: "已被其他设备领取", detail: translateWorkspace("此派单已在其他设备领取，这台电脑不会执行。") }
    case 'unverified': return {
      label: "待核实",
      detail: availability.reason === 'recovery_evidence_missing'
        ? translateWorkspace("这台电脑缺少核验这条派单所需的凭据，因此不会执行。请刷新后核对当前派单；若仍无法核验，请联系负责人确认状态后再决定是否重新派发。")
        : translateWorkspace("暂时无法确认这条派单的当前状态，因此不会执行。请刷新后核对，无需重复接受或立即重新派发。")
    }
    case 'invalid': return {
      label: "已失效",
      detail: availability.reason === 'offer_expired' ? translateWorkspace("派单已到期，请联系负责人重新派发。")
        : availability.reason === 'contract_changed' ? translateWorkspace("任务合同已变更，需要新的派单和人工授权。")
          : availability.reason === 'authority_changed' ? translateWorkspace("当前账户或设备已无权处理此派单。")
            : translateWorkspace("派单已关闭或已由你处理，不能在这台电脑继续接受。")
    }
  }
}
