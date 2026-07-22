import { ImportWizard } from "../../../components/ImportWizard";
import { apiSafe } from "../../../lib/api";
import { formatDateTime, formatNumber } from "../../../lib/format";

export const dynamic = "force-dynamic";

type ImportJob = {
  id: string;
  fileName: string;
  state: string;
  rowCount: number | null;
  createdCount: number;
  updatedCount: number;
  erroredCount: number;
  createdAt: string;
  undoneAt: string | null;
  undoAvailableUntil: string | null;
};

export default async function ImportPage() {
  const history = await apiSafe<{ imports: ImportJob[] }>("/workspace/imports");

  return (
    <>
      <div className="topbar">
        <h1>Import contacts</h1>
      </div>

      <div className="content">
        <div style={{ maxWidth: 880 }}>
          <ImportWizard />

          {history.ok && history.data.imports.length > 0 && (
            <div className="card mt-24">
              <div className="card-head">
                <h2>Recent imports</h2>
                <span className="sub">Imports can be undone within 24 hours</span>
              </div>
              <div className="table-wrap">
                <table className="table">
                  <thead>
                    <tr>
                      <th>File</th>
                      <th>When</th>
                      <th className="text-right">Created</th>
                      <th className="text-right">Updated</th>
                      <th className="text-right">Errors</th>
                      <th>Status</th>
                    </tr>
                  </thead>
                  <tbody>
                    {history.data.imports.map((job) => {
                      const undoable =
                        !job.undoneAt && job.undoAvailableUntil && new Date(job.undoAvailableUntil) > new Date();
                      return (
                        <tr key={job.id}>
                          <td>
                            <strong>{job.fileName}</strong>
                            <div className="faint small">{formatNumber(job.rowCount ?? 0)} rows</div>
                          </td>
                          <td className="faint small nowrap">{formatDateTime(job.createdAt)}</td>
                          <td className="text-right">{formatNumber(job.createdCount)}</td>
                          <td className="text-right">{formatNumber(job.updatedCount)}</td>
                          <td className="text-right">
                            {job.erroredCount > 0 ? (
                              <span className="badge badge-warn">{formatNumber(job.erroredCount)}</span>
                            ) : (
                              <span className="faint">0</span>
                            )}
                          </td>
                          <td>
                            {job.undoneAt ? (
                              <span className="badge badge-muted">undone</span>
                            ) : undoable ? (
                              <span className="badge badge-info">undoable</span>
                            ) : (
                              <span className="badge badge-ok">final</span>
                            )}
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            </div>
          )}
        </div>
      </div>
    </>
  );
}
