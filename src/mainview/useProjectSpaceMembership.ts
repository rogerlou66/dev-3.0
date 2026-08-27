import { spacesOfProject, type Space, type SpacesFile } from "../shared/types";
import { api } from "./rpc";
import { toast } from "./toast";
import { useT } from "./i18n";

/**
 * Membership writes for one project, shared by every surface that edits them
 * (Project Settings field, dashboard row action). Toasts the spaces that were
 * auto-deleted because the project was their last member.
 */
export function useProjectSpaceMembership(file: SpacesFile) {
	const t = useT();

	function selectedIdsOf(projectId: string): string[] {
		return spacesOfProject(file.spaces, projectId).map((s) => s.id);
	}

	async function setMemberships(projectId: string, spaceIds: string[]): Promise<void> {
		try {
			const { autoDeleted } = await api.request.setProjectSpaces({ projectId, spaceIds });
			for (const space of autoDeleted) {
				toast.info(t("spaces.autoDeleted", { name: space.name }));
			}
		} catch (err) {
			toast.error(t("spaces.failedUpdate", { error: String(err) }));
		}
	}

	async function toggle(projectId: string, spaceId: string): Promise<void> {
		const current = selectedIdsOf(projectId);
		const next = current.includes(spaceId)
			? current.filter((id) => id !== spaceId)
			: [...current, spaceId];
		await setMemberships(projectId, next);
	}

	async function createWithProject(name: string, projectId: string): Promise<Space | null> {
		try {
			return await api.request.createSpace({ name, projectIds: [projectId] });
		} catch (err) {
			toast.error(t("spaces.failedCreate", { error: String(err) }));
			return null;
		}
	}

	return { selectedIdsOf, setMemberships, toggle, createWithProject };
}
