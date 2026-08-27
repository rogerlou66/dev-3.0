import { spacesOfProject, type Space } from "../../shared/types";

/**
 * Project ids visible in the sidebar's `space` scope: the union of members
 * across every space the project belongs to (itself included). Null when the
 * project is in no space — the scope button renders disabled.
 */
export function spaceSiblingProjectIds(spaces: Space[], projectId: string): Set<string> | null {
	const memberships = spacesOfProject(spaces, projectId);
	if (memberships.length === 0) return null;
	return new Set(memberships.flatMap((s) => s.projectIds));
}
