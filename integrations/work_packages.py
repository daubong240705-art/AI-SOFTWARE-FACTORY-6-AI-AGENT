import uuid

from asf_api.db import SessionLocal
from asf_api.models import ExternalLink
from sqlalchemy import select

from integrations.services import sync_work_package
from orchestrator.service import Fence, artifact, event, get_run
from shared.config import get_settings
from shared.profiles import IntegrationProfile


def sync(run_id: uuid.UUID, fence: Fence) -> None:
    with SessionLocal.begin() as session:
        run = get_run(session, run_id, fence)
        target = run.config_snapshot.get("integration")
        if run.mode != "live" or not target:
            return
        profile = IntegrationProfile.model_validate(target)
        content = {
            kind: item.content
            for kind in ("plan", "spec")
            if (item := artifact(session, run, kind))
        }
        wp = sync_work_package(
            profile.openproject_project_id,
            profile.work_package_type_id,
            f"ASF {run.id}:v{run.spec_version}",
            content,
        )
        link = session.scalar(
            select(ExternalLink).where(
                ExternalLink.run_id == run.id,
                ExternalLink.kind == "work_package",
                ExternalLink.version == run.spec_version,
            )
        )
        if not link:
            link = ExternalLink(
                run_id=run.id,
                kind="work_package",
                version=run.spec_version,
                external_id=str(wp["id"]),
                url=(get_settings().openproject_url.rstrip("/") + f"/work_packages/{wp['id']}"),
                data={},
            )
            session.add(link)
        event(
            session,
            run,
            "openproject.synced",
            {"work_package_id": wp["id"], "kinds": list(content)},
        )
