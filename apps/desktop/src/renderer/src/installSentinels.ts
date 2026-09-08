import type { InstallOutcome } from './api'
import { t } from './i18n'
import type { ZipMultiPakPayload } from './components/ZipPickerModal'
import type { HostPackPayload } from './components/HostPackModal'
import type { CbFlatArchivePayload } from './components/CrimeBossFlatArchiveModal'
import type { LoaderReplacePayload } from './components/Ue4ssReplaceModal'

/**
 * An install command resolves to a typed InstallOutcome: 'installed', or one of five
 * "needs a UI decision" prompts (multi-pak picker, host-pack choice, Crime Boss flat
 * archive confirm, UE4SS replacement confirm, unrecognized archive). Every install entry
 * point must handle all five.
 *
 * This is the single dispatcher every caller routes through. The handlers object is
 * required in full, so forgetting a prompt is a compile error, and a new outcome
 * variant breaks this switch (and therefore every call site) until it's handled.
 */
export interface InstallSentinelHandlers {
    onZipMultiPak: (payload: ZipMultiPakPayload) => void
    onHostModPack: (payload: HostPackPayload) => void
    onCbFlatArchive: (payload: CbFlatArchivePayload) => void
    onLoaderReplace: (payload: LoaderReplacePayload) => void
    onUnrecognizedArchive: () => void
}

/**
 * Returns true if the outcome was a prompt and the matching handler ran; false
 * means the install completed. The command enriches every prompt payload with the
 * mod context (modId, modName, ...) before it reaches the renderer, so the cast to
 * the modal-facing payload types is sound.
 */
/**
 * For install entry points that have no picker UI of their own: dependency rows in
 * DepsTab, DepsWarningModal and HealthCheckModal. A prompt outcome there means the
 * archive needs a manual choice they cannot offer, so they must say so rather than
 * discard the outcome and appear to do nothing. Returns null when the install
 * completed. The dependency's own mod page has the full flow.
 */
export function uninstallablePromptMessage(outcome: InstallOutcome): string | null {
    return outcome === 'installed' ? null : t('common.depNeedsManualInstall')
}

export function handleInstallOutcome(
    outcome: InstallOutcome,
    handlers: InstallSentinelHandlers
): boolean {
    if (outcome === 'installed') return false
    if (outcome === 'unrecognized') {
        handlers.onUnrecognizedArchive()
        return true
    }
    if ('needsPicker' in outcome) {
        handlers.onZipMultiPak(outcome.needsPicker as unknown as ZipMultiPakPayload)
        return true
    }
    if ('needsHostChoice' in outcome) {
        handlers.onHostModPack(outcome.needsHostChoice as unknown as HostPackPayload)
        return true
    }
    if ('needsLoaderConfirm' in outcome) {
        handlers.onLoaderReplace(outcome.needsLoaderConfirm as unknown as LoaderReplacePayload)
        return true
    }
    handlers.onCbFlatArchive(outcome.needsCbFlatConfirm as unknown as CbFlatArchivePayload)
    return true
}
