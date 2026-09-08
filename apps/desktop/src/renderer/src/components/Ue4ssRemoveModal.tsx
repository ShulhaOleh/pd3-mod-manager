import { useEffect, useState } from 'react'
import { Button } from './ui/Button'
import { Dialog, DialogHeader } from './Dialog'
import { t } from '../i18n'
import { api, type ReplacementPlan } from '../api'
import { FileList } from './Ue4ssReplaceModal'

interface Props {
    gameId: string
    gamePath: string
    onRefreshInstalled: () => Promise<void>
    onClose: () => void
}

/**
 * Confirms removing the installed UE4SS.
 *
 * The loader is not tracked like a mod, so nothing in the mod list says which files it owns.
 * The same plan the replacement reads is shown here, because "remove" has to name what it
 * deletes before it deletes it.
 */
export function Ue4ssRemoveModal({ gameId, gamePath, onRefreshInstalled, onClose }: Props) {
    const [plan, setPlan] = useState<ReplacementPlan | null>(null)
    const [busy, setBusy] = useState(false)
    const [error, setError] = useState<string | null>(null)

    useEffect(() => {
        let cancelled = false
        api.ue4ssPlan(gameId, gamePath)
            .then((p) => {
                if (!cancelled) setPlan(p)
            })
            .catch((e) => {
                if (!cancelled) setError(String(e))
            })
        return () => {
            cancelled = true
        }
    }, [gameId, gamePath])

    async function handleRemove() {
        setBusy(true)
        setError(null)
        try {
            await api.uninstallUe4ss(gameId, gamePath)
            await onRefreshInstalled()
            onClose()
        } catch (e) {
            setError(String(e))
            setBusy(false)
        }
    }

    return (
        <Dialog
            open={true}
            onOpenChange={(open) => !open && !busy && onClose()}
            title={t('ue4ssRemove.title')}
            className="w-[520px]"
        >
            <DialogHeader title={t('ue4ssRemove.title')} onClose={onClose} closeDisabled={busy} />

            <div className="px-5 py-4 flex flex-col gap-4">
                {error && (
                    <div className="px-4 py-3 rounded-lg bg-danger/30 border border-danger-hover text-sm text-danger-text">
                        {error}
                    </div>
                )}
                <p className="text-sm text-text-muted">{t('ue4ssRemove.body')}</p>
                {plan === null && !error ? (
                    <p className="text-sm text-text-muted">{t('common.loading')}</p>
                ) : (
                    plan && (
                        <>
                            {plan.replaced.length > 0 && (
                                <FileList
                                    heading={t('ue4ssRemove.removed')}
                                    paths={plan.replaced}
                                />
                            )}
                            {plan.preserved.length > 0 ? (
                                <FileList heading={t('ue4ssRemove.kept')} paths={plan.preserved} />
                            ) : (
                                <p className="text-sm text-text-muted">
                                    {t('ue4ssRemove.nothingOfYours')}
                                </p>
                            )}
                        </>
                    )
                )}
            </div>

            <div className="flex items-center justify-end gap-2 px-5 py-4 border-t border-border shrink-0">
                <Button
                    variant="secondary"
                    size="md"
                    onClick={!busy ? onClose : undefined}
                    disabled={busy}
                >
                    {t('common.cancel')}
                </Button>
                <Button
                    variant="danger"
                    size="lg"
                    disabled={busy || plan === null}
                    onClick={handleRemove}
                >
                    {busy ? t('ue4ssRemove.removing') : t('common.remove')}
                </Button>
            </div>
        </Dialog>
    )
}
